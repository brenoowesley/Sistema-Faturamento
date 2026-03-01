import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({ version: 'v3', auth });
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || 'dummy_root_id';

async function getOrCreateFolder(folderName: string, parentFolderId: string) {
    try {
        const q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;
        const res = await drive.files.list({
            q,
            fields: 'files(id, name)',
            spaces: 'drive',
            pageSize: 1
        });

        if (res.data.files && res.data.files.length > 0 && res.data.files[0].id) {
            return res.data.files[0].id;
        } else {
            const fileMetadata = {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentFolderId]
            };
            const createRes = await drive.files.create({
                requestBody: fileMetadata,
                fields: 'id'
            });
            return createRes.data.id;
        }
    } catch (error) {
        console.error('Erro ao procurar/criar pasta:', folderName, error);
        throw error;
    }
}

export async function POST(req: NextRequest) {
    try {
        const { loteId, tipo } = await req.json();

        if (!loteId) {
            return NextResponse.json({ error: "loteId is required" }, { status: 400 });
        }

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        // 1. Fetch Lote
        const { data: lote, error: loteErr } = await supabase
            .from("faturamentos_lote")
            .select("*")
            .eq("id", loteId)
            .single();

        if (loteErr || !lote) throw new Error("Lote não encontrado");

        // 2. Fetch Consolidated Data (Financeiro Fechado)
        const { data: consolidados, error: consErr } = await supabase
            .from("faturamento_consolidados")
            .select(`
                *,
                data_competencia,
                observacao_report,
                clientes (
                    id, nome_fantasia, razao_social, cnpj, endereco, bairro, cidade, estado, cep,
                    codigo_ibge, email_principal, emails_faturamento, nome_conta_azul, loja_mae_id,
                    ciclos_faturamento(nome)
                )
            `)
            .eq("lote_id", loteId);

        if (consErr) throw consErr;

        if (!consolidados || consolidados.length === 0) {
            return NextResponse.json({
                error: "Não há dados consolidados para este lote. Realize o processamento fiscal (ZIP) novamente."
            }, { status: 400 });
        }

        // 3. Fetch Raw Agendamentos (Para os Descritivos) — paginado para superar o limite de 1000 linhas do Supabase
        let agendamentos: any[] = [];
        let agFrom = 0;
        const agStep = 1000;
        let agHasMore = true;
        while (agHasMore) {
            const { data: agChunk, error: agErr } = await supabase
                .from("agendamentos_brutos")
                .select(`
                    *,
                    clientes(id, razao_social, cnpj)
                `)
                .eq("lote_id", loteId)
                .in("status_validacao", ["VALIDADO"])
                .order("data_inicio", { ascending: true })
                .range(agFrom, agFrom + agStep - 1);

            if (agErr) throw agErr;
            if (agChunk && agChunk.length > 0) {
                agendamentos = [...agendamentos, ...agChunk];
                agFrom += agStep;
            }
            if (!agChunk || agChunk.length < agStep) agHasMore = false;
        }
        console.log(`[GCP DISPATCH] Total agendamentos validados carregados (paginado): ${agendamentos.length}`);

        const payloadNC: any[] = [];
        const payloadHC: any[] = [];
        const lojaAgendamentosMap = new Map<string, any[]>();

        // 4.5 Fetch Ajustes Faturamentos (Acrescimos/Descontos detalhados)
        const storeIds = Array.from(new Set(agendamentos.map((a: any) => a.loja_id)));
        const { data: ajustes, error: ajesErr } = await supabase
            .from("ajustes_faturamento")
            .select("*")
            .in("cliente_id", storeIds)
            .or(`lote_aplicado_id.eq.${loteId},status_aplicacao.eq.false`);

        if (ajesErr) {
            console.error("Erro ao buscar ajustes detalhados:", ajesErr);
        }
        const ajustesValidos = ajustes || [];

        // Agrupa os agendamentos pelo ID real da loja que o realizou (útil para Leta Filiais)
        agendamentos.forEach(ag => {
            const lojaId = ag.loja_id;
            if (!lojaAgendamentosMap.has(lojaId)) {
                lojaAgendamentosMap.set(lojaId, []);
            }
            lojaAgendamentosMap.get(lojaId)!.push({
                inicio: ag.data_inicio,
                termino: ag.data_fim,
                fracao_hora: ag.fracao_hora,
                valor: ag.valor_iwof,
                profissional: ag.nome_profissional,
                vaga: ag.vaga || null,
                cnpj_execucao: ag.cnpj_loja || (ag.clientes as any)?.cnpj,
                razao_social_execucao: (ag.clientes as any)?.razao_social
            });
        });

        const formatarParaGCP = (valor: number) => {
            return Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };
        const formatDateStr = (dateStr: string) => {
            if (!dateStr) return "-";
            const d = new Date(dateStr);
            return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' });
        };
        const buildMatriz = (ags: any[]) => {
            return ags.sort((a: any, b: any) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime())
                .map((ag: any) => [
                    ag.profissional || "N/A",
                    ag.vaga || "-",
                    formatDateStr(ag.inicio),
                    formatDateStr(ag.termino),
                    `R$ ${formatarParaGCP(ag.valor)}`,
                    formatarParaGCP(ag.fracao_hora)
                ]);
        };

        // Cache para reduzir DB hits da Leta
        const filiaisLetaMap = new Map<string, any[]>();

        // Loop pelos registros consolidados (que já agrupam filiais na matriz se for Leta para a NC)
        for (const cons of consolidados) {
            const cliente = cons.clientes as any;
            const ciclo = cliente.ciclos_faturamento?.nome || "GERAL";
            const isNordestao = ciclo === "NORDESTÃO";
            const isLeta = ciclo === "LETA";
            const isQueiroz = ciclo === "QUEIROZ";

            // 1. Cálculos Numéricos crus para base matemática
            const numBruto = Number(cons.valor_bruto || 0);
            const numAcrescimos = Number(cons.acrescimos || 0);
            const numDescontos = Number(cons.descontos || 0);

            const valorBase = numBruto + numAcrescimos - numDescontos;
            const valorNC = valorBase * 0.885;
            const valorNF = valorBase * 0.115;
            const valorIRRF = Number(cons.valor_ir_xml || 0);
            const valorLiquido = valorBase - valorIRRF;

            // Calcula matrizes financeiras
            const financeiroPayload = {
                lote_id: lote.id,
                cliente_id: cliente.id,
                razao_social: cliente.razao_social,
                nome_fantasia: cliente.nome_fantasia,
                cnpj: cliente.cnpj,
                endereco: { logradouro: cliente.endereco, bairro: cliente.bairro, cidade: cliente.cidade, uf: cliente.estado, cep: cliente.cep, ibge: cliente.codigo_ibge },
                contato: { email: cliente.email_principal, emails_faturamento: cliente.emails_faturamento },
                valor_bruto: formatarParaGCP(numBruto),
                acrescimos: formatarParaGCP(numAcrescimos),
                descontos: formatarParaGCP(numDescontos),
                valor_nf_emitida: formatarParaGCP(valorNF),
                irrf_presumido: formatarParaGCP(valorIRRF),
                valor_liquido_boleto: formatarParaGCP(valorLiquido),
                valor_nc_final: formatarParaGCP(valorNC),
                data_competencia: cons.data_competencia || lote.data_competencia,
                observacoes_descritivo: cons.observacao_report || ""
            };
            // ==========================================
            // LISTAS DE ACRÉSCIMOS E DESCONTOS
            // ==========================================
            const lojaAjustes = ajustesValidos.filter((a: any) => a.cliente_id === cliente.id);
            const listaAcrescimosOriginal = lojaAjustes.filter((a: any) => a.tipo === "ACRESCIMO");
            const listaDescontosOriginal = lojaAjustes.filter((a: any) => a.tipo === "DESCONTO");

            const mapAjustes = (arr: any[]) => arr.map(item => ({
                profissional: item.nome_profissional || "N/A",
                motivo: item.motivo || "Sem justificação",
                data: formatDateStr(item.data_ocorrencia || item.created_at),
                valor: formatarParaGCP(Number(item.valor || 0))
            }));

            const lista_acrescimos = mapAjustes(listaAcrescimosOriginal);
            const lista_descontos = mapAjustes(listaDescontosOriginal);

            const totalAcrescimo = listaAcrescimosOriginal.reduce((acc: number, curr: any) => acc + Number(curr.valor || 0), 0);
            const totalDesconto = listaDescontosOriginal.reduce((acc: number, curr: any) => acc + Number(curr.valor || 0), 0);

            const temValor = valorBase >= 0; // Garantir validacao 0 inclusive

            if (temValor) {
                // ==========================================
                // REGRAS DO PAYLOAD DE NOTA CRÉDITO (NC)
                // Usando as chaves espelhadas do Python GCP
                // ==========================================
                const numNotaFiscal = cons.numero_nf ? String(cons.numero_nf) : "A Gerar";

                if (!isNordestao) {
                    payloadNC.push({
                        "LOJA": cliente.nome_conta_azul || cliente.razao_social,
                        "CNPJ": cliente.cnpj,
                        "Nº NF": numNotaFiscal,
                        "NC": financeiroPayload.valor_nc_final,
                        "gerar_nota_credito": true
                    });
                } else {
                    payloadNC.push({
                        "LOJA": cliente.nome_conta_azul || cliente.razao_social,
                        "CNPJ": cliente.cnpj,
                        "Nº NF": numNotaFiscal,
                        "NC": financeiroPayload.valor_nc_final,
                        "gerar_nota_credito": false
                    });
                }

                // ==========================================
                // REGRAS DO PAYLOAD DE DESCRITIVO HORAS (HC)
                // ==========================================

                // Queiroz Fatiamento de Competências
                let agsDaLoja = lojaAgendamentosMap.get(cliente.id) || [];

                if (isQueiroz && cons.data_competencia) {
                    // Seleciona agendamentos apenas do mes/ano especifico
                    const mesAnoRef = cons.data_competencia.substring(0, 7); // ex: "2024-02"
                    agsDaLoja = agsDaLoja.filter(ag => ag.inicio.startsWith(mesAnoRef));
                }

                if (isLeta) {
                    // LETA MESTRA E SUAS FILIAIS - INJETAR SEPARADAMENTE

                    // 1. A Matriz — usa valores consolidados (mesma base do Fechamento Financeiro)
                    if (agsDaLoja.length > 0) {
                        payloadHC.push({
                            info_loja: {
                                "LOJA": cliente.nome_conta_azul || cliente.razao_social,
                                "CNPJ": cliente.cnpj,
                                "Nº NF": numNotaFiscal,
                                "VALOR_BRUTO": financeiroPayload.valor_bruto,
                                "ACRESCIMO": financeiroPayload.acrescimos,
                                "DESCONTO": financeiroPayload.descontos,
                                "IRRF": financeiroPayload.irrf_presumido,
                                "VALOR_LIQUIDO": financeiroPayload.valor_liquido_boleto,
                                "NF": financeiroPayload.valor_nf_emitida,
                                "NC": financeiroPayload.valor_nc_final
                            },
                            lista_acrescimos: lista_acrescimos,
                            lista_descontos: lista_descontos,
                            faturamento_headers: ["Nome", "Vaga", "Início", "Término", "Valor IWOF", "Fração de hora computada"],
                            itens_faturados_rows: buildMatriz(agsDaLoja)
                        });
                    }

                    // 2. Coletar as filiais no BD
                    if (!filiaisLetaMap.has(cliente.id)) {
                        const { data: filiais } = await supabase.from("clientes").select("*").eq("loja_mae_id", cliente.id);
                        filiaisLetaMap.set(cliente.id, filiais || []);
                    }

                    const filiaisDaMestra = filiaisLetaMap.get(cliente.id) || [];

                    for (const filial of filiaisDaMestra) {
                        const agsFilial = lojaAgendamentosMap.get(filial.id);

                        if (agsFilial && agsFilial.length > 0) {
                            const filialAjustes = ajustesValidos?.filter((a: any) => a.cliente_id === filial.id) || [];
                            const filialAcrescimosOrig = filialAjustes.filter((a: any) => a.tipo === "ACRESCIMO") || [];
                            const filialDescontosOrig = filialAjustes.filter((a: any) => a.tipo === "DESCONTO") || [];

                            const filialListaAcrescimos = filialAcrescimosOrig.length > 0 ? mapAjustes(filialAcrescimosOrig) : [];
                            const filialListaDescontos = filialDescontosOrig.length > 0 ? mapAjustes(filialDescontosOrig) : [];

                            const filialTotalAcrescimo = filialAcrescimosOrig.reduce((acc: number, curr: any) => acc + Number(curr.valor || 0), 0);
                            const filialTotalDesconto = filialDescontosOrig.reduce((acc: number, curr: any) => acc + Number(curr.valor || 0), 0);

                            const brutoFilial = agsFilial.reduce((acc, curr) => acc + curr.valor, 0);
                            const baseFilialVirtual = brutoFilial + filialTotalAcrescimo - filialTotalDesconto;
                            // O IRRF não incide na filial pois ele desce da Loja Mãe se configurado

                            payloadHC.push({
                                info_loja: {
                                    "LOJA": filial.nome_conta_azul || filial.razao_social,
                                    "CNPJ": filial.cnpj,
                                    "Nº NF": "A Gerar",
                                    "VALOR_BRUTO": formatarParaGCP(brutoFilial),
                                    "ACRESCIMO": formatarParaGCP(filialTotalAcrescimo),
                                    "DESCONTO": formatarParaGCP(filialTotalDesconto),
                                    "IRRF": formatarParaGCP(0),
                                    "VALOR_LIQUIDO": formatarParaGCP(baseFilialVirtual),
                                    "NF": formatarParaGCP(baseFilialVirtual * 0.115),
                                    "NC": formatarParaGCP(baseFilialVirtual * 0.885)
                                },
                                lista_acrescimos: filialListaAcrescimos,
                                lista_descontos: filialListaDescontos,
                                faturamento_headers: ["Nome", "Vaga", "Início", "Término", "Valor IWOF", "Fração de hora computada"],
                                itens_faturados_rows: buildMatriz(agsFilial)
                            });
                        }
                    }

                } else {
                    // TODAS AS OUTRAS LOJAS E NORDESTÃO (Não-LETA)
                    // Usa valores consolidados do faturamento_consolidados (mesma base do Fechamento Financeiro)
                    // Os ajustes e IRRF já estão calculados em financeiroPayload
                    payloadHC.push({
                        info_loja: {
                            "LOJA": cliente.nome_conta_azul || cliente.razao_social,
                            "CNPJ": cliente.cnpj,
                            "Nº NF": numNotaFiscal,
                            "VALOR_BRUTO": financeiroPayload.valor_bruto,
                            "ACRESCIMO": financeiroPayload.acrescimos,
                            "DESCONTO": financeiroPayload.descontos,
                            "IRRF": financeiroPayload.irrf_presumido,
                            "VALOR_LIQUIDO": financeiroPayload.valor_liquido_boleto,
                            "NF": financeiroPayload.valor_nf_emitida,
                            "NC": financeiroPayload.valor_nc_final
                        },
                        lista_acrescimos: lista_acrescimos,
                        lista_descontos: lista_descontos,
                        faturamento_headers: ["Nome", "Vaga", "Início", "Término", "Valor IWOF", "Fração de hora computada"],
                        itens_faturados_rows: buildMatriz(agsDaLoja)
                    });
                }
            }
        }

        // Recupera o nome do ciclo para envelopar o pacote NC
        const { data: cicloLote } = lote.ciclo_faturamento_id
            ? await supabase.from("ciclos_faturamento").select("nome").eq("id", lote.ciclo_faturamento_id).single()
            : { data: null };

        // Evita erro de offset UTC (Ex 11-02-2025T03:00 vs 10-02-2025T21:00)
        const formatDataSegura = (isoString: string) => {
            if (!isoString) return '';
            const [ano, mes, dia] = isoString.split('T')[0].split('-');
            return `${dia}/${mes}/${ano}`;
        };

        const dInicio = formatDataSegura(lote.data_inicio_ciclo);
        const dFim = formatDataSegura(lote.data_fim_ciclo);

        const cycleNameStr = lote.nome_pasta ? lote.nome_pasta : (cicloLote?.nome || `Lote_${lote.id.substring(0, 8)}`);
        const cyclePeriodStr = `${dInicio} à ${dFim}`;

        let rootFolderId = lote.drive_folder_id;
        if (!rootFolderId && ROOT_FOLDER_ID !== 'dummy_root_id') {
            rootFolderId = await getOrCreateFolder(cycleNameStr, ROOT_FOLDER_ID);
            // Salva o ID no Supabase para as próximas requisições
            await supabase.from('faturamentos_lote').update({ drive_folder_id: rootFolderId }).eq('id', loteId);
            console.log(`[DRIVE CACHE] Pasta Mestre '${cycleNameStr}' criada e travada com ID: ${rootFolderId}`);
        } else if (rootFolderId) {
            console.log(`[DRIVE CACHE] Usando Pasta Mestre Existente '${cycleNameStr}': ${rootFolderId}`);
        }

        const pubNCUrl = process.env.GCP_PUB_NC_URL;
        const pubHCUrl = process.env.GCP_PUB_HC_URL;
        const gcpToken = process.env.GCP_AUTH_TOKEN;

        if (!pubNCUrl || !pubHCUrl) {
            console.warn("URLs do Pub/Sub faltantes. Simulando sucesso para UI.");
            return NextResponse.json({
                success: true,
                message: "Ambiente local: Disparos seriam enviados para o Pub/Sub do GCP.",
                payloads: { NC: "PAYLOAD_NC_OMITIDO_SIMULACAO", HC: "PAYLOAD_HC_OMITIDO_SIMULACAO" }
            });
        }

        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (gcpToken) {
            headers["Authorization"] = `Bearer ${gcpToken}`;
        }

        const gcpRequests: (() => Promise<Response>)[] = [];

        // 1. DISPARO PARA HCs (Loop Individual com RootFolder pre-criada)
        if ((!tipo || tipo === "HC") && pubHCUrl && payloadHC.length > 0) {
            for (const lojaHC of payloadHC) {
                const envioHCLoja = {
                    nome_pasta_ciclo: cycleNameStr,
                    ciclo_mensal: cyclePeriodStr,
                    rootFolderId: rootFolderId,
                    ...lojaHC
                };
                gcpRequests.push(() => fetch(pubHCUrl, { method: "POST", headers, body: JSON.stringify(envioHCLoja) }));
            }
        }

        // 2. DISPARO PARA NCs (Loop Individual com RootFolder pre-criada)
        if ((!tipo || tipo === "NC") && pubNCUrl && payloadNC.length > 0) {
            for (const lojaNC of payloadNC) {
                // FIX: Adicionado ciclo_mensal para o GCP agrupar corretamente a pasta do mês
                const envioNCLoja = {
                    nome_pasta_ciclo: cycleNameStr,
                    ciclo_mensal: cyclePeriodStr,
                    rootFolderId: rootFolderId,
                    ...lojaNC
                };
                gcpRequests.push(() => fetch(pubNCUrl, { method: "POST", headers, body: JSON.stringify(envioNCLoja) }));
            }
        }

        if (gcpRequests.length === 0) {
            throw new Error("Nenhum payload válido gerado para o tipo selecionado ou URLs Master não configuradas.");
        }
        // 3. Executa os disparos globais (Vanguarda + Chunks)
        try {
            if (gcpRequests.length > 0) {
                console.log(`⏳ Aguardando 10s para indexação total da pasta Lote Mestre no Google Drive (Eventual Consistency)...`);
                await new Promise(resolve => setTimeout(resolve, 10000));

                console.log(`💥 Disparando as ${gcpRequests.length} requisições restantes em Chunks (Lotes de 10)...`);
                const chunkSize = 10;
                const responses: Response[] = [];

                for (let c = 0; c < gcpRequests.length; c += chunkSize) {
                    const chunk = gcpRequests.slice(c, c + chunkSize);
                    const restResponses = await Promise.all(chunk.map(task => task()));
                    responses.push(...restResponses);

                    // Pequena pausa entre lotes para manter a estabilidade do GCP
                    if (c + chunkSize < gcpRequests.length) {
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    }
                }

                for (let i = 0; i < responses.length; i++) {
                    const res = responses[i];
                    if (!res.ok) {
                        const errorText = await res.text();
                        console.error(`[ERRO GCP (Requisição ${i + 1})]: Status ${res.status} ->`, errorText);
                        throw new Error(`Falha no Google Cloud (Status ${res.status}). Verifique o terminal para detalhes.`);
                    }
                }
            }
        } catch (fetchErr: any) {
            console.error("ERRO FATAL NO DISPARO FETCH (PUB/SUB):", fetchErr);
            throw new Error(`Falha no disparo ao GCP: ${fetchErr.message}`);
        }

        return NextResponse.json({
            success: true,
            message: "Geração iniciada no GCP"
        });

    } catch (error: any) {
        console.error("ERRO FATAL NO DISPARO GCP:", error);
        return NextResponse.json({ error: error.message || "Erro interno na rota do GCP" }, { status: 500 });
    }
}
