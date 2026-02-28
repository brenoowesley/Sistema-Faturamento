import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { agendamentos, lojasSemNF } = body;

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
                id, razao_social, nome_fantasia, cnpj, nome_conta_azul,
                loja_mae_id,
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
                    id, razao_social, nome_fantasia, cnpj, nome_conta_azul,
                    loja_mae_id,
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

        const results = Array.from(finalAgrupado.values()).map(r => {
            const c = r.clientes || {};
            const baseResumo = (r.valor_bruto + r.acrescimos) - r.descontos;

            // Revalidate isSemNF after LETA mapping (Check if current OR mother is in semNFSet originally by their raw IDs)
            let isSemNF = semNFSet.has(c.id);
            // We can also fallback to the original payload's id match but since we swapped the client object to mother's, the mother id check applies natively.

            const nf = isSemNF ? 0 : Math.max(0, baseResumo * 0.115);
            const nc = isSemNF ? baseResumo : Math.max(0, baseResumo * 0.885);

            return {
                id: c.id || r.cliente_id,
                nome_conta_azul: c.nome_conta_azul,
                razao_social: c.razao_social || "Razão Social Não Encontrada",
                cnpj: c.cnpj || "S/N",
                ciclo: c.ciclos_faturamento?.nome || "S/ Ciclo",
                gerou_nfse: !isSemNF,
                boleto_base: r.valor_bruto,
                acrescimos: r.acrescimos,
                descontos: r.descontos,
                nc: nc,
                nf: nf,
                boleto_final: baseResumo
            };
        });

        // Sort results by Nome Conta Azul alphabetically
        results.sort((a, b) => (a.nome_conta_azul || a.razao_social).localeCompare(b.nome_conta_azul || b.razao_social));

        return NextResponse.json(results, { status: 200 });

    } catch (err: any) {
        console.error("Resumo API Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
