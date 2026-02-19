
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as xlsx from "xlsx";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const loteId = searchParams.get("loteId");

        if (!loteId) {
            return NextResponse.json({ error: "loteId is required" }, { status: 400 });
        }

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        // 1. Fetch ALL store data for this batch (not just validated) to identify exclusions
        const { data: allInBatchRaw, error: allInBatchErr } = await supabase
            .from("agendamentos_brutos")
            .select("loja_id, status_validacao, valor_iwof, clientes(razao_social, cnpj)")
            .eq("lote_id", loteId);

        if (allInBatchErr) throw allInBatchErr;

        // Group all batch attempts by store to see what they are trying to process
        const allStoresInBatchMap = new Map<string, { cnpj: string; nome: string; status: Set<string>; totalTentado: number }>();
        allInBatchRaw?.forEach(a => {
            if (!allStoresInBatchMap.has(a.loja_id)) {
                allStoresInBatchMap.set(a.loja_id, {
                    cnpj: (a.clientes as any)?.cnpj || "S/N",
                    nome: (a.clientes as any)?.razao_social || "S/N",
                    status: new Set(),
                    totalTentado: 0
                });
            }
            const s = allStoresInBatchMap.get(a.loja_id)!;
            s.status.add(a.status_validacao);
            s.totalTentado += Number(a.valor_iwof) || 0;
        });

        // 2. Fetch data to EXPORT (Consolidated or Simulated)
        let { data: records, error: recordsErr } = await supabase
            .from("faturamento_consolidados")
            .select(`
                *,
                lotes:faturamentos_lote (data_inicio_ciclo, data_fim_ciclo),
                clientes (
                    razao_social, cnpj, email_principal, emails_faturamento,
                    endereco, numero, complemento, bairro, cidade, estado, cep, codigo_ibge
                )
            `)
            .eq("lote_id", loteId);

        if (recordsErr) throw recordsErr;

        let simulationUsed = false;
        // If no consolidated records, fetch raw data and simulate consolidation
        if (!records || records.length === 0) {
            simulationUsed = true;
            console.log("Simulando exportação a partir de agendamentos brutos...");

            // Fetch lote info
            const { data: lote, error: loteErr } = await supabase
                .from("faturamentos_lote")
                .select("data_inicio_ciclo, data_fim_ciclo")
                .eq("id", loteId)
                .single();
            if (loteErr) throw loteErr;

            // Fetch ADJUSTMENTS for the simulated batch
            const { data: ajustes, error: ajErr } = await supabase
                .from("ajustes_faturamento")
                .select("*")
                .in("cliente_id", Array.from(allStoresInBatchMap.keys()))
                .eq("status_aplicacao", false);
            if (ajErr) throw ajErr;

            // Consolidate in memory
            const consolidatedMap = new Map<string, any>();

            allInBatchRaw?.filter(a => a.status_validacao === "VALIDADO").forEach(a => {
                const lojaId = a.loja_id;
                if (!consolidatedMap.has(lojaId)) {
                    consolidatedMap.set(lojaId, {
                        cliente_id: lojaId, // Store ID here for audit comparison
                        valor_bruto: 0,
                        acrescimos: 0,
                        descontos: 0,
                        clientes: a.clientes,
                        lotes: lote
                    });
                }
                const store = consolidatedMap.get(lojaId)!;
                store.valor_bruto += Number(a.valor_iwof) || 0;
            });

            ajustes.forEach(aj => {
                const store = consolidatedMap.get(aj.cliente_id);
                if (store) {
                    if (aj.tipo === "ACRESCIMO") store.acrescimos += Number(aj.valor);
                    if (aj.tipo === "DESCONTO") store.descontos += Number(aj.valor);
                }
            });

            records = Array.from(consolidatedMap.values()).map(r => {
                const base = (r.valor_bruto + r.acrescimos) - r.descontos;
                return {
                    ...r,
                    valor_nf_emitida: Math.max(0, base * 0.115) // Consistency fix: use full base, floor at 0
                };
            });
        }

        // AUDIT & EXCLUSIONS LOGIC
        const excludedList: any[] = [];

        console.log(`[EXPORT AUDIT] Lote: ${loteId}`);
        console.log(`[EXPORT AUDIT] Total de lojas no Lote (Bruto): ${allStoresInBatchMap.size}`);
        console.log(`[EXPORT AUDIT] Total de lojas exportadas para NFE: ${records?.length || 0}`);

        allStoresInBatchMap.forEach((store, id) => {
            const isExported = records?.some(r => r.cliente_id === id);

            if (!isExported) {
                let motivo = "Desconhecido";
                if (simulationUsed) {
                    if (!store.status.has("VALIDADO")) {
                        motivo = `Agendamentos possuem status: ${Array.from(store.status).join(", ")} (Nenhum como 'VALIDADO')`;
                    } else {
                        // This case implies that even if VALIDADO, the final calculated value was <= 0
                        motivo = `Valor líquido final resultou em zero ou negativo após descontos.`;
                    }
                } else {
                    motivo = "Loja não incluída na consolidação final do lote (Fechar Lote).";
                }

                console.warn(`[EXPORT AUDIT] EXCLUÍDO: ${store.cnpj} - ${store.nome}. Motivo: ${motivo}`);
                excludedList.push({
                    "CNPJ": store.cnpj,
                    "NOME": store.nome,
                    "VALOR_TENTADO": store.totalTentado,
                    "STATUS_NO_LOTE": Array.from(store.status).join(", "),
                    "MOTIVO_EXCLUSAO": motivo
                });
            } else {
                const r = records?.find(rec => rec.cliente_id === id || (rec.clientes as any)?.id === id);
                console.log(`[EXPORT AUDIT] OK: ${store.cnpj} - ${store.nome} | Valor NF: ${r?.valor_nf_emitida}`);
            }
        });

        if (!records || records.length === 0) {
            // If no records to export, but there might be exclusions, still generate a file with just exclusions
            if (excludedList.length === 0) {
                return NextResponse.json({ error: "No records found (none validated and no exclusions to report)" }, { status: 404 });
            }
            // If only exclusions, proceed to generate the file with just the exclusion sheet
        }

        const fmtDate = (d: string) => {
            if (!d) return "";
            const [y, m, day] = d.split('-');
            return `${day}/${m}/${y}`;
        };

        const fmtCurrency = (val: number) => {
            return new Intl.NumberFormat("pt-BR", {
                style: "currency",
                currency: "BRL"
            }).format(val);
        };

        // 3. Map exactly to 19 columns
        const colunasNFE = [
            "CPF_CNPJ", "Nome", "Email", "Valor", "Codigo_Servico", "Endereco_Pais",
            "Endereco_Cep", "Endereco_Logradouro", "Endereco_Numero", "Endereco_Complemento",
            "Endereco_Bairro", "Endereco_Cidade_Codigo", "Endereco_Cidade_Nome", "Endereco_Estado",
            "Descricao", "Data_Competencia", "IBSCBS_Indicador_Operacao", "IBSCBS_Codigo_Classificacao", "NBS"
        ];

        const dadosMapeados = records?.filter(rec => rec.valor_nf_emitida > 0).map((rec) => {
            const c = rec.clientes as any;
            const l = rec.lotes as any;

            return {
                "CPF_CNPJ": c.cnpj ? c.cnpj.replace(/\D/g, "") : "",
                "Nome": c.razao_social || "",
                "Email": c.email_principal || c.emails_faturamento || "",
                "Valor": Number(rec.valor_nf_emitida.toFixed(2)),
                "Codigo_Servico": "100202",
                "Endereco_Pais": "BRA",
                "Endereco_Cep": c.cep ? c.cep.replace(/\D/g, "") : "",
                "Endereco_Logradouro": c.endereco || "",
                "Endereco_Numero": c.numero || "",
                "Endereco_Complemento": c.complemento || "",
                "Endereco_Bairro": c.bairro || "",
                "Endereco_Cidade_Codigo": c.codigo_ibge || "",
                "Endereco_Cidade_Nome": c.cidade || "",
                "Endereco_Estado": c.estado || "",
                "Descricao": `Horas utilizadas: ${fmtDate(l?.data_inicio_ciclo)} À ${fmtDate(l?.data_fim_ciclo)}`,
                "Data_Competencia": "",
                "IBSCBS_Indicador_Operacao": "100301",
                "IBSCBS_Codigo_Classificacao": "000001",
                "NBS": "109051200"
            };
        }) || [];

        // 4. Create XLSX with two sheets
        const workbook = xlsx.utils.book_new();

        if (dadosMapeados.length > 0) {
            // Force structure by passing header array
            const worksheetNFE = xlsx.utils.json_to_sheet(dadosMapeados, { header: colunasNFE });
            xlsx.utils.book_append_sheet(workbook, worksheetNFE, "LOTE NFE.io");
        }

        if (excludedList.length > 0) {
            const worksheetExcluded = xlsx.utils.json_to_sheet(excludedList);
            xlsx.utils.book_append_sheet(workbook, worksheetExcluded, "Lojas EXCLUÍDAS");
        }

        // If no sheets were added, return an error
        if (workbook.SheetNames.length === 0) {
            return NextResponse.json({ error: "No data to export (no NFE records and no exclusions)" }, { status: 404 });
        }

        const buffer = xlsx.write(workbook, { bookType: "xlsx", type: "buffer" });

        // 5. Return file
        return new NextResponse(buffer, {
            status: 200,
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="nfe_lote_${loteId}.xlsx"`
            }
        });

    } catch (err: any) {
        console.error("Export Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
