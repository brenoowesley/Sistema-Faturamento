
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as xlsx from "xlsx";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const loteId = searchParams.get("loteId");

        if (!loteId) {
            return NextResponse.json({ error: "loteId is required" }, { status: 400 });
        }

        const supabase = await createClient();

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
                .maybeSingle();

            if (loteErr) {
                console.error("Erro ao buscar dados do lote:", loteErr);
                throw loteErr;
            }
            if (!lote) {
                return NextResponse.json({ error: "Lote não encontrado no banco de dados." }, { status: 404 });
            }

            // Fetch raw data only for validated stores directly
            const { data: validatedRaw, error: valErr } = await supabase
                .from("agendamentos_brutos")
                .select(`
                    loja_id, 
                    valor_iwof, 
                    clientes (
                        razao_social, nome_fantasia, cnpj, email_principal, emails_faturamento,
                        endereco, numero, complemento, bairro, cidade, estado, cep, codigo_ibge,
                        boleto_unificado, tempo_pagamento_dias
                    )
                `)
                .eq("lote_id", loteId)
                .eq("status_validacao", "VALIDADO");

            if (valErr) throw valErr;

            const validStoreIds = Array.from(new Set((validatedRaw || []).map(r => r.loja_id)));

            // Fetch ADJUSTMENTS for the simulated batch
            const { data: ajustes, error: ajErr } = await supabase
                .from("ajustes_faturamento")
                .select("*")
                .in("cliente_id", validStoreIds)
                .eq("status_aplicacao", false);
            if (ajErr) throw ajErr;

            // Consolidate in memory strictly by client id
            const consolidatedMap = new Map<string, any>();

            validatedRaw?.forEach(a => {
                const lojaId = a.loja_id;
                if (!consolidatedMap.has(lojaId)) {
                    consolidatedMap.set(lojaId, {
                        cliente_id: lojaId,
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
                const baseResumo = (r.valor_bruto + r.acrescimos) - r.descontos;
                return {
                    ...r,
                    valor_base_calculo: baseResumo,
                    valor_nf_emitida: Math.max(0, baseResumo * 0.115)
                };
            });
        }

        if (!records || records.length === 0) {
            return NextResponse.json({ error: "No consolidated records found to export" }, { status: 404 });
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

        // NF Emitidas (Valor > 0)
        const dadosEmitidos = records?.filter(rec => rec.valor_nf_emitida > 0).map((rec) => {
            const c = rec.clientes as any || {};
            const l = rec.lotes as any || {};

            return {
                "CPF_CNPJ": c.cnpj ? c.cnpj.replace(/\D/g, "") : "",
                "Nome": c.razao_social || "",
                "Email": c.email_principal || c.emails_faturamento || "",
                "Valor": Number((rec.valor_nf_emitida || 0).toFixed(2)),
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

        // NF Não Emitidas (Valor <= 0)
        const dadosNaoEmitidos = records?.filter(rec => rec.valor_nf_emitida <= 0).map(rec => ({
            "Loja": (rec.clientes as any)?.razao_social || "S/N",
            "CNPJ": (rec.clientes as any)?.cnpj || "S/N",
            "Valor Base": rec.valor_bruto,
            "Motivo": "Valor líquido zero ou negativo após descontos"
        })) || [];

        // 4. Create XLSX with two sheets
        console.log(`[DIAGNÓSTICO NFE] Lote ID processado.`);
        console.log(`[DIAGNÓSTICO NFE] Total de registros puxados do banco para este lote: ${records?.length || 0}`);

        const cnpjsUnicos = new Set(records?.map(r => (r.clientes as any)?.cnpj)).size;
        console.log(`[DIAGNÓSTICO NFE] CNPJs únicos encontrados nos dados: ${cnpjsUnicos}`);

        const workbook = xlsx.utils.book_new();

        const worksheetEmitida = xlsx.utils.json_to_sheet(dadosEmitidos, { header: colunasNFE });
        xlsx.utils.book_append_sheet(workbook, worksheetEmitida, "NF emitida");

        const worksheetNaoEmitida = xlsx.utils.json_to_sheet(dadosNaoEmitidos);
        xlsx.utils.book_append_sheet(workbook, worksheetNaoEmitida, "NF não emitida");

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
