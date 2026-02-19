
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

        // 1. Fetch data. We try consolidated first, if empty, we simulate from agendamentos
        let { data: records, error } = await supabase
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

        if (error) throw error;

        // If no consolidated records, fetch raw data and simulate consolidation
        if (!records || records.length === 0) {
            console.log("Simulando exportação a partir de agendamentos brutos...");

            // Fetch lote info
            const { data: lote, error: loteErr } = await supabase
                .from("faturamentos_lote")
                .select("data_inicio_ciclo, data_fim_ciclo")
                .eq("id", loteId)
                .single();
            if (loteErr) throw loteErr;

            // Fetch validated agendamentos
            const { data: agendamentos, error: agendErr } = await supabase
                .from("agendamentos_brutos")
                .select("loja_id, valor_iwof, clientes(*)")
                .eq("lote_id", loteId)
                .eq("status_validacao", "VALIDADO");
            if (agendErr) throw agendErr;

            // Fetch adjustments
            const { data: ajustes, error: ajErr } = await supabase
                .from("ajustes_faturamento")
                .select("*")
                .eq("lote_aplicado_id", loteId);
            if (ajErr) throw ajErr;

            // Consolidate in memory
            const consolidatedMap = new Map<string, any>();

            agendamentos.forEach(a => {
                if (!consolidatedMap.has(a.loja_id)) {
                    consolidatedMap.set(a.loja_id, {
                        valor_bruto: 0,
                        acrescimos: 0,
                        descontos: 0,
                        clientes: a.clientes,
                        lotes: lote
                    });
                }
                const store = consolidatedMap.get(a.loja_id)!;
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
                    valor_nf_emitida: base * 0.115 // Consistency fix: use full base
                };
            }).filter(r => r.valor_nf_emitida > 0);
        }

        if (!records || records.length === 0) {
            return NextResponse.json({ error: "No records found (none validated or NF value is zero)" }, { status: 404 });
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

        // 2. Map exactly to 19 columns
        const dadosMapeados = records.map((rec) => {
            const c = rec.clientes as any;
            const l = rec.lotes as any;

            return {
                "CPF_CNPJ": c.cnpj ? c.cnpj.replace(/\D/g, "") : "",
                "Nome": c.razao_social,
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
        });

        // 3. Create XLSX
        const worksheet = xlsx.utils.json_to_sheet(dadosMapeados);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, "NFE");
        const buffer = xlsx.write(workbook, { bookType: "xlsx", type: "buffer" });

        // 4. Return file
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
