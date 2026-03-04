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

        /* ─── Gatilho Master NC (Payload Único) ─── */
        if (!pubMasterNCUrl) {
            console.error("[NC EMITIR] GCP_PUB_MASTER_NC_URL não configurada.");
            return NextResponse.json(
                { error: "URL do Gatilho Master não encontrada no ambiente." },
                { status: 500 }
            );
        }

        const masterPayload = {
            nome_pasta_ciclo: nomePasta || "Notas_Credito",
            ciclo_mensal: cyclePeriod,
            data_faturamento: new Date().toLocaleDateString("pt-BR"),
            lojas: payloadsNC,
        };

        const responseGCP = await fetch(pubMasterNCUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(masterPayload),
        });

        if (!responseGCP.ok) {
            const txt = await responseGCP.text();
            console.error(`[NC EMITIR] Erro no Gatilho Master: ${responseGCP.status} — ${txt}`);
            return NextResponse.json(
                { error: `Erro no GCP Master: ${txt.slice(0, 150)}` },
                { status: responseGCP.status }
            );
        }

        console.log(`[NC EMITIR] Master NC disparado com sucesso para ${items.length} lojas.`);

        const resultados = items.map(item => ({
            loja: item.loja,
            ok: true,
            mensagem: "Enviado via mestre",
        }));

        return NextResponse.json({
            success: true,
            enviados: items.length,
            erros: 0,
            resultados,
            message: `Lote de ${items.length} Notas de Crédito enviado com sucesso para processamento master.`,
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
