import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
    getTransfeeraToken,
    getTransfeeraBaseUrl,
    formatarChavePix,
    normalizePixKeyType,
    UA_HEADER
} from "@/lib/transfeera";

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
        }

        const { lote_id } = await req.json();

        if (!lote_id) {
            return NextResponse.json({ error: "ID do lote não informado." }, { status: 400 });
        }

        // ═══ PASSO 1: Preparação (Supabase) ═══════════════════════════════════
        const { data: lote, error: loteError } = await supabase
            .from("lotes_saques")
            .select("*")
            .eq("id", lote_id)
            .single();

        if (loteError || !lote) {
            return NextResponse.json({ error: "Lote não encontrado." }, { status: 404 });
        }

        const { data: items, error: itemsError } = await supabase
            .from("itens_saque")
            .select("*")
            .eq("lote_id", lote_id)
            .eq("status_item", "APROVADO");

        if (itemsError) {
            return NextResponse.json({ error: "Erro ao buscar itens do lote." }, { status: 500 });
        }

        const itensValidos = (items || []).filter((item: any) => Number(item.valor) > 0);

        if (itensValidos.length === 0) {
            return NextResponse.json({ error: "Nenhum item válido (valor > 0) encontrado para envio." }, { status: 400 });
        }

        // ═══ PASSO 2: Montagem do Payload Bulk ════════════════════════════════
        const transfersPayload = itensValidos.map((item: any) => ({
            value: Number(item.valor),
            integration_id: String(item.id),
            description: "REPASSE IWOF",
            destination_bank_account: {
                pix_key_type: normalizePixKeyType(item.tipo_pix),
                pix_key: formatarChavePix(item.tipo_pix, item.chave_pix),
            }
        }));

        // ═══ PASSO 3: Requisição Única (POST /batch) ══════════════════════════
        const token = await getTransfeeraToken();
        const baseUrl = getTransfeeraBaseUrl();

        const batchRes = await fetch(`${baseUrl}/batch`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": UA_HEADER,
            },
            body: JSON.stringify({
                name: lote.nome_lote,
                type: "TRANSFERENCIA",
                auto_close: true,
                transfers: transfersPayload,
            }),
        });

        const batchBody = await batchRes.json();

        // ═══ PASSO 4: Tratamento 'Tudo ou Nada' ══════════════════════════════
        if (!batchRes.ok) {
            console.error("❌ [Transfeera Bulk] Erro ao criar batch:", JSON.stringify(batchBody, null, 2));
            return NextResponse.json({
                error: "A Transfeera rejeitou o lote. Corrija os itens inválidos e tente novamente.",
                transfeera_error: batchBody.message || batchBody,
            }, { status: 400 });
        }

        // ═══ PASSO 5: Fechamento e Atualização (Caminho Feliz) ════════════════
        const transfeeraBatchId = String(batchBody.id);



        if (!closeRes.ok) {
            // Lote foi criado mas não fechado — salvar batch_id para não perder referência
            await supabase.from("lotes_saques").update({ transfeera_batch_id: transfeeraBatchId }).eq("id", lote_id);

        }

        // 5b. Extrair IDs de transferências e atualizar itens_saque
        const createdTransfers: any[] = batchBody.transfers || [];
        if (createdTransfers.length > 0) {
            const updatePromises = createdTransfers.map((t: any) => {
                const integrationId = t.integration_id;
                const transferId = String(t.id);
                return supabase
                    .from("itens_saque")
                    .update({ transfeera_transfer_id: transferId })
                    .eq("id", integrationId);
            });
            await Promise.all(updatePromises);
        }

        // 5c. Atualizar status do lote
        await supabase
            .from("lotes_saques")
            .update({
                status: "PROCESSANDO",
                transfeera_batch_id: transfeeraBatchId,
            })
            .eq("id", lote_id);

        console.log(`✅ [Transfeera Bulk] Lote aprovado, fechado e em processamento! batch_id=${transfeeraBatchId}, ${itensValidos.length} transferências.`);

        return NextResponse.json({
            success: true,
            batch_id: transfeeraBatchId,
            items_count: itensValidos.length,
        });

    } catch (err: any) {
        console.error("❌ [Transfeera Bulk] Erro interno:", err);
        return NextResponse.json({ error: err.message || "Erro interno no servidor" }, { status: 500 });
    }
}
