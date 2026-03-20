import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Normalizador do Status da Transfeera para nosso formato interno
function normalizeTransfeeraStatus(raw: string | null | undefined): string {
    if (!raw) return "NAO_SUBMETIDO";
    const s = raw.toUpperCase().trim();

    if (["FINALIZADA", "FINALIZADO", "PAGO", "CONCLUIDO", "CONCLUÍDO", "EFETIVADO"].includes(s)) {
        return "FINALIZADO";
    }
    
    if (["DEVOLVIDA", "DEVOLVIDO", "RETURNED"].includes(s)) {
        return "DEVOLVIDO";
    }

    if (["FALHA", "FAILED", "ERROR", "REJEITADA"].includes(s)) {
        return "FALHA";
    }

    if (["CRIADA", "CRIADO", "CREATED", "AGENDADO", "SCHEDULED"].includes(s)) {
        return "AGENDADO";
    }

    if (["EM_PROCESSAMENTO", "PROCESSANDO", "EM_PROCESSAMENTO_BANCO", "RECEBIDO", "AGUARDANDO_RECEBIMENTO"].includes(s)) {
        return "EM_PROCESSAMENTO";
    }
    
    if (["CANCELADA", "CANCELADO"].includes(s)) {
        return "REMOVIDO";
    }

    // Fallback de segurança 
    return "EM_PROCESSAMENTO";
}

export async function POST(req: NextRequest) {
    try {
        // Inicializa o Supabase utilizando a Service Role Key (Não possui sessão logada)
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        
        if (!supabaseUrl || !supabaseServiceRoleKey) {
            console.error("[Transfeera Webhook] Erro: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes no .env");
            return NextResponse.json({ error: "Erro de configuração do servidor" }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

        const payload = await req.json();
        
        console.log("[Transfeera Webhook] 🔔 Recebendo notificação:", JSON.stringify({
            event: payload.event,
            integration_id: payload.object?.integration_id,
            id: payload.object?.id,
            status: payload.object?.status,
        }));

        const { event, object } = payload;

        // Se o evento não for correspondente a transferência ou objeto inválido, apenas retorna OK
        if (!event?.startsWith("transfer.") || !object || !object.integration_id || !object.id) {
            console.log("[Transfeera Webhook] Evento ignorado ou payload incompleto.");
            return NextResponse.json({ success: true, message: "Acknowledged" }, { status: 200 });
        }

        const transfeeraTransferId = String(object.id);
        const integrationId = String(object.integration_id).toLowerCase();
        const rawStatus = String(object.status);
        const statusNormalized = normalizeTransfeeraStatus(rawStatus);

        console.log(`[Transfeera Webhook] Atualizando Supabase: integration_id=${integrationId} -> transfer_id=${transfeeraTransferId}, status=${statusNormalized}`);

        // Atualizar a linha na tabela de itens_saque via integration_id
        const { error: updateError } = await supabase
            .from("itens_saque")
            .update({ 
                transfeera_transfer_id: transfeeraTransferId,
                status_item: statusNormalized,
            })
            .eq("id", integrationId);

        if (updateError) {
            console.error(`[Transfeera Webhook] ❌ Erro ao atualizar item ${integrationId}:`, updateError.message);
            // Ainda retornamos 200 OK para a Transfeera não ficar repetindo (a menos que seja falha fatal)
        } else {
            console.log(`[Transfeera Webhook] ✅ Status do item ${integrationId} sincronizado com sucesso.`);
        }

        // É crucial devolver rapidamente um response HTTP 200 OK
        return NextResponse.json({ success: true }, { status: 200 });

    } catch (error: any) {
        console.error("[Transfeera Webhook] Critical Error:", error);
        // Em webhooks, se algo estourar o catch, podemos retornar 500 para pedir retry
        return NextResponse.json({ error: "Erro interno ao processar webhook" }, { status: 500 });
    }
}
