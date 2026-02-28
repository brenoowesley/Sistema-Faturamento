import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as xlsx from "xlsx";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { agendamentos, lojasSemNF, periodoInicio, periodoFim } = body;

        if (!agendamentos || !Array.isArray(agendamentos)) {
            return NextResponse.json({ error: "agendamentos payload is required" }, { status: 400 });
        }

        const supabase = await createClient();

        // Extrair IDs de clientes únicos do agendamentos
        const validStoreIds = Array.from(new Set(agendamentos.map(a => a.clienteId).filter(Boolean))) as string[];

        // Buscar dados completos dos clientes
        const { data: dbClientes, error: cliErr } = await supabase
            .from("clientes")
            .select(`
                id, razao_social, nome_fantasia, cnpj, email_principal, emails_faturamento, nome_conta_azul,
                endereco, numero, complemento, bairro, cidade, estado, cep, codigo_ibge,
                loja_mae_id, boleto_unificado, tempo_pagamento_dias,
                ciclos_faturamento(id, nome)
            `)
            .in("id", validStoreIds);

        if (cliErr) throw cliErr;

        // Fetch missing mother stores if any exist
        const motherIdsToFetch = new Set<string>();
        dbClientes?.forEach(c => {
            if (c.loja_mae_id && !validStoreIds.includes(c.loja_mae_id)) {
                motherIdsToFetch.add(c.loja_mae_id);
            }
        });

        let allClients = [...(dbClientes || [])];

        if (motherIdsToFetch.size > 0) {
            const { data: motherClients, error: motherErr } = await supabase
                .from("clientes")
                .select(`
                    id, razao_social, nome_fantasia, cnpj, email_principal, emails_faturamento, nome_conta_azul,
                    endereco, numero, complemento, bairro, cidade, estado, cep, codigo_ibge,
                    loja_mae_id, boleto_unificado, tempo_pagamento_dias,
                    ciclos_faturamento(id, nome)
                `)
                .in("id", Array.from(motherIdsToFetch));

            if (!motherErr && motherClients) {
                allClients = [...allClients, ...motherClients];
            }
        }

        // Buscar AJUSTES
        const { data: ajustes, error: ajErr } = await supabase
            .from("ajustes_faturamento")
            .select("*")
            .in("cliente_id", validStoreIds)
            .eq("status_aplicacao", false);

        if (ajErr) throw ajErr;

        // Consolidate in memory strictly by client id
        const consolidatedMap = new Map<string, any>();
        const clienteMap = new Map(allClients.map(c => [c.id, c]));

        agendamentos.forEach(a => {
            const lojaId = a.clienteId;
            if (!lojaId) return;

            if (!consolidatedMap.has(lojaId)) {
                consolidatedMap.set(lojaId, {
                    cliente_id: lojaId,
                    valor_bruto: 0,
                    acrescimos: 0,
                    descontos: 0,
                    clientes: clienteMap.get(lojaId),
                    lotes: { data_inicio_ciclo: periodoInicio, data_fim_ciclo: periodoFim },
                    data_competencia: a.rawRow?.data_competencia || ""
                });
            }
            const store = consolidatedMap.get(lojaId)!;
            store.valor_bruto += Number(a.status === "CORREÇÃO" ? (a.suggestedValorIwof ?? a.valorIwof) : (a.manualValue ?? a.valorIwof)) || 0;
        });

        ajustes?.forEach(aj => {
            const store = consolidatedMap.get(aj.cliente_id);
            if (store) {
                if (aj.tipo === "ACRESCIMO") store.acrescimos += Number(aj.valor);
                if (aj.tipo === "DESCONTO") store.descontos += Number(aj.valor);
            }
        });

        const finalAgrupado = new Map<string, any>();
        Array.from(consolidatedMap.values()).forEach(r => {
            const clientData = r.clientes || {};

            // LETA Logic: If the store is part of the LETA cycle (or explicitly named LETA) and has a mother store, cluster under Mother.
            const isLeta = clientData.ciclos_faturamento?.nome?.toUpperCase().includes('LETA') || clientData.razao_social?.toUpperCase().includes('LETA');

            let targetId = clientData.cnpj || r.cliente_id;
            let effectiveClientData = clientData;

            if (isLeta && clientData.loja_mae_id) {
                const motherData = clienteMap.get(clientData.loja_mae_id);
                if (motherData) {
                    targetId = motherData.cnpj || motherData.id;
                    effectiveClientData = motherData;
                }
            }

            if (!finalAgrupado.has(targetId)) {
                finalAgrupado.set(targetId, { ...r, clientes: effectiveClientData });
            } else {
                const grouped = finalAgrupado.get(targetId)!;
                grouped.valor_bruto += r.valor_bruto;
                grouped.acrescimos += r.acrescimos;
                grouped.descontos += r.descontos;
            }
        });

        const semNFSet = new Set(lojasSemNF || []);

        const records = Array.from(finalAgrupado.values()).map(r => {
            const baseResumo = (r.valor_bruto + r.acrescimos) - r.descontos;
            const isSemNF = semNFSet.has(r.cliente_id) || semNFSet.has(r.clientes?.loja_mae_id);
            return {
                ...r,
                valor_base_calculo: baseResumo,
                valor_nf_emitida: isSemNF ? 0 : Math.max(0, baseResumo * 0.115)
            };
        });

        const fmtDate = (d: string) => {
            if (!d) return "";
            if (d.includes("-")) {
                const parts = d.split('-');
                if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
                return d;
            }
            return d;
        };

        const colunasNFE = [
            "CPF_CNPJ", "Nome", "Email", "Valor", "Codigo_Servico", "Endereco_Pais",
            "Endereco_Cep", "Endereco_Logradouro", "Endereco_Numero", "Endereco_Complemento",
            "Endereco_Bairro", "Endereco_Cidade_Codigo", "Endereco_Cidade_Nome", "Endereco_Estado",
            "Descricao", "Data_Competencia", "IBSCBS_Indicador_Operacao", "IBSCBS_Codigo_Classificacao", "NBS"
        ];

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
                "Data_Competencia": rec.data_competencia || "",
                "IBSCBS_Indicador_Operacao": "100301",
                "IBSCBS_Codigo_Classificacao": "000001",
                "NBS": "109051200"
            };
        }) || [];

        const dadosNaoEmitidos = records?.filter(rec => rec.valor_nf_emitida <= 0).map(rec => ({
            "Loja": (rec.clientes as any)?.razao_social || "S/N",
            "CNPJ": (rec.clientes as any)?.cnpj || "S/N",
            "Valor Base": rec.valor_bruto,
            "Motivo": "NF inibida ou Valor líquido zero"
        })) || [];

        const workbook = xlsx.utils.book_new();

        const worksheetEmitida = xlsx.utils.json_to_sheet(dadosEmitidos, { header: colunasNFE });
        xlsx.utils.book_append_sheet(workbook, worksheetEmitida, "NF emitida");

        const worksheetNaoEmitida = xlsx.utils.json_to_sheet(dadosNaoEmitidos);
        xlsx.utils.book_append_sheet(workbook, worksheetNaoEmitida, "NF não emitida");

        const buffer = xlsx.write(workbook, { bookType: "xlsx", type: "buffer" });

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="nfe_simulada.xlsx"`
            }
        });

    } catch (err: any) {
        console.error("Export Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
