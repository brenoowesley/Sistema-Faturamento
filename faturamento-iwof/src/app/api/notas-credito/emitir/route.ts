import { NextRequest, NextResponse } from "next/server";

/* ================================================================
   API ROUTE EXCLUSIVA: /api/notas-credito/emitir
   ================================================================
   ⚠️ ESCOPO ISOLADO: Este route NÃO usa loteId, NÃO altera
   a rota existente `disparar-gcp/route.ts` e NÃO acessa
   faturamentos_lote ou faturamento_consolidados.

   Recebe: { items: NotaCreditoPlanilha[], nomePasta: string }
   Retorna: { success, enviados, erros, resultados[] }
   ================================================================ */

/** Tipagem local do módulo NC — espelho de NotaCreditoPlanilha */
interface NotaCreditoPlanilhaPayload {
    loja: string;
    cnpj: string;
    estado: string;
    valorBoleto: number;
    valorNF: number;
    valorNC: number;
    descricaoServico: string;
}

/** Formata número para string monetária brasileira: "1.572,30" */
function formatarParaGCP_NC(valor: number): string {
    return Number(valor).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { items, nomePasta } = body as {
            items: NotaCreditoPlanilhaPayload[];
            nomePasta: string;
        };

        if (!items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json(
                { error: "items é obrigatório e deve ser um array não-vazio." },
                { status: 400 }
            );
        }

        const pubNCUrl = process.env.GCP_PUB_NC_URL;
        const pubMasterNCUrl = process.env.GCP_PUB_MASTER_NC_URL;
        const gcpToken = process.env.GCP_AUTH_TOKEN;

        /* ─── Fallback local (sem URL configurada) ─── */
        if (!pubNCUrl) {
            console.warn("[NC EMITIR] GCP_PUB_NC_URL não configurada. Retornando simulação.");
            const simulados = items.map(item => ({
                loja: item.loja,
                ok: true,
                mensagem: "Simulado (sem URL GCP configurada)",
            }));
            return NextResponse.json({
                success: true,
                message: "Ambiente local: disparos simulados.",
                enviados: items.length,
                erros: 0,
                resultados: simulados,
            });
        }

        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (gcpToken) {
            headers["Authorization"] = `Bearer ${gcpToken}`;
        }

        const cyclePeriod = new Date().toLocaleDateString("pt-BR");

        /* ─── Monta payloads individuais NC ─── */
        /**
         * Formato esperado pelo GCP Python consumer (idêntico ao gerado pelo
         * disparar-gcp/route.ts, mas sem as chaves HC / info_loja extras):
         *   nome_pasta_ciclo  — pasta no Drive
         *   LOJA              — nome da loja
         *   CNPJ              — CNPJ (somente dígitos, sem formatação)
         *   Nº NF             — número ou descrição da NF
         *   NC                — valor NC formatado "1.572,30"
         *   gerar_nota_credito— true para disparar geração (false = Nordestão)
         */
        const payloadsNC = items.map(item => ({
            nome_pasta_ciclo: nomePasta || "Notas_Credito",
            "LOJA": item.loja,
            "CNPJ": item.cnpj,
            "Nº NF": item.descricaoServico || "A Gerar",
            "NC": formatarParaGCP_NC(item.valorNC),
            "NF": formatarParaGCP_NC(item.valorNF),
            "BOLETO": formatarParaGCP_NC(item.valorBoleto),
            "ESTADO": item.estado,
            "gerar_nota_credito": true,
        }));

        /* ─── Disparo individual para cada loja ─── */
        const resultados: { loja: string; ok: boolean; mensagem: string }[] = [];
        let enviados = 0;
        let erros = 0;

        for (const payload of payloadsNC) {
            try {
                const res = await fetch(pubNCUrl, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload),
                });

                if (!res.ok) {
                    const txt = await res.text();
                    console.error(`[NC EMITIR] Erro GCP para ${payload["LOJA"]}: ${res.status} — ${txt}`);
                    resultados.push({ loja: payload["LOJA"], ok: false, mensagem: `Status ${res.status}: ${txt.slice(0, 120)}` });
                    erros++;
                } else {
                    resultados.push({ loja: payload["LOJA"], ok: true, mensagem: "Enviado" });
                    enviados++;
                }
            } catch (fetchErr: unknown) {
                const msg = fetchErr instanceof Error ? fetchErr.message : "Erro desconhecido";
                console.error(`[NC EMITIR] Fetch error para ${payload["LOJA"]}:`, msg);
                resultados.push({ loja: payload["LOJA"], ok: false, mensagem: msg });
                erros++;
            }
        }

        /* ─── Gatilho Master NC (após todos individuais) ─── */
        if (pubMasterNCUrl && enviados > 0) {
            try {
                const masterPayload = {
                    nome_pasta_ciclo: nomePasta || "Notas_Credito",
                    ciclo_mensal: cyclePeriod,
                    data_faturamento: new Date().toLocaleDateString("pt-BR"),
                    lojas: payloadsNC,
                };
                const masterRes = await fetch(pubMasterNCUrl, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(masterPayload),
                });
                if (!masterRes.ok) {
                    const txt = await masterRes.text();
                    console.warn("[NC EMITIR] Master NC retornou erro (não bloqueante):", masterRes.status, txt);
                } else {
                    console.log(`[NC EMITIR] Master NC disparado para pasta: ${nomePasta}`);
                }
            } catch (e) {
                console.warn("[NC EMITIR] Falha no Master NC (não bloqueante):", e);
            }
        }

        console.log(`[NC EMITIR] Concluído: ${enviados} enviados, ${erros} erros de ${items.length} total.`);

        return NextResponse.json({
            success: erros === 0,
            enviados,
            erros,
            resultados,
            message: erros === 0
                ? "Todas as Notas de Crédito foram disparadas com sucesso."
                : `${enviados} enviadas, ${erros} com erro.`,
        });

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Erro interno";
        console.error("[NC EMITIR] ERRO FATAL:", error);
        return NextResponse.json(
            { error: msg },
            { status: 500 }
        );
    }
}
