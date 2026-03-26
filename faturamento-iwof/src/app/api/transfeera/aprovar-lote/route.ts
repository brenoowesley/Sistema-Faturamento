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

        // 1. Consultar dados do lote
        const { data: lote, error: loteError } = await supabase
            .from("lotes_saques")
            .select("*")
            .eq("id", lote_id)
            .single();

        if (loteError || !lote) {
            return NextResponse.json({ error: "Lote não encontrado." }, { status: 404 });
        }

        // 2. Autenticar com Transfeera
        const token = await getTransfeeraToken();
        const baseUrl = getTransfeeraBaseUrl();

        // 3. CRIAÇÃO IDEMPOTENTE: Verificar se o lote já possui transfeera_batch_id
        let transfeeraBatchId = lote.transfeera_batch_id ? String(lote.transfeera_batch_id) : null;

        if (!transfeeraBatchId) {
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
                }),
            });

            const batchBody = await batchRes.json();
            if (!batchRes.ok) {
                return NextResponse.json({ error: "Erro ao criar lote na Transfeera.", details: batchBody }, { status: batchRes.status });
            }

            transfeeraBatchId = String(batchBody.id);

            // Salvar imediatamente o ID para idempotência
            await supabase
                .from("lotes_saques")
                .update({ transfeera_batch_id: transfeeraBatchId })
                .eq("id", lote_id);
        }

        // 4. ENVIO PARCIAL: Buscar apenas itens APROVADOS que ainda não possuem transfeera_transfer_id
        const { data: items, error: itemsError } = await supabase
            .from("itens_saque")
            .select("*")
            .eq("lote_id", lote_id)
            .eq("status_item", "APROVADO")
            .is("transfeera_transfer_id", null);

        if (itemsError) {
            return NextResponse.json({ error: "Erro ao buscar itens do lote." }, { status: 500 });
        }

        const itensValidos = (items || []).filter((item: any) => Number(item.valor) > 0);

        // 5. Enviar individualmente com captura de falhas POR ITEM
        let successCount = 0;
        let failedCount = 0;

        if (itensValidos.length > 0) {
            const results = await Promise.allSettled(itensValidos.map(async (item: any) => {
                const payload = {
                    value: Number(item.valor),
                    integration_id: String(item.id),
                    description: "REPASSE IWOF",
                    destination_bank_account: {
                        favored_name: item.nome_usuario,
                        favored_cpf_cnpj: item.cpf_favorecido.replace(/\D/g, ""),
                        pix_key: formatarChavePix(item.tipo_pix, item.chave_pix),
                        pix_key_type: normalizePixKeyType(item.tipo_pix),
                    }
                };

                const tRes = await fetch(`${baseUrl}/batch/${transfeeraBatchId}/transfer`, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "Content-Type": "application/json",
                        "User-Agent": UA_HEADER,
                    },
                    body: JSON.stringify(payload),
                });

                const tBody = await tRes.json();
                if (!tRes.ok) {
                    // Marcar item como REVISAO no banco com o erro
                    await supabase
                        .from("itens_saque")
                        .update({
                            status_item: "REVISAO",
                            motivo_bloqueio: `Transfeera: ${tBody.message || JSON.stringify(tBody)}`,
                        })
                        .eq("id", item.id);
                    throw new Error(`${item.nome_usuario}: ${tBody.message || "Erro desconhecido"}`);
                }

                // Sucesso: salvar transfeera_transfer_id
                await supabase
                    .from("itens_saque")
                    .update({ transfeera_transfer_id: String(tBody.id) })
                    .eq("id", item.id);

                return { id: item.id, transfeera_id: tBody.id };
            }));

            for (const r of results) {
                if (r.status === "fulfilled") successCount++;
                else failedCount++;
            }
        }

        // 6. A TRAVA DO FECHAMENTO: Contagem de itens sem transfeera_transfer_id
        const { count: pendingCount } = await supabase
            .from("itens_saque")
            .select("*", { count: "exact", head: true })
            .eq("lote_id", lote_id)
            .is("transfeera_transfer_id", null)
            .in("status_item", ["APROVADO", "REVISAO"]);

        if ((pendingCount ?? 0) > 0) {
            // NÃO FECHAR O LOTE — retornar 207 (sucesso parcial)
            console.warn(`⚠️ [Transfeera Approval] Lote ${lote_id}: ${pendingCount} itens pendentes. Lote NÃO fechado.`);
            return NextResponse.json({
                closed: false,
                success_count: successCount,
                failed_count: pendingCount,
                message: `${pendingCount} transferência(s) falharam ou estão pendentes. Corrija ou exclua os itens destacados para fechar o lote.`,
            }, { status: 207 });
        }

        // 7. 100% dos itens têm transfeera_transfer_id → FECHAR O LOTE
        const closeRes = await fetch(`${baseUrl}/batch/${transfeeraBatchId}/close`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": UA_HEADER,
            },
        });

        if (!closeRes.ok) {
            const closeBody = await closeRes.json();
            return NextResponse.json({ error: "Erro ao fechar o lote na Transfeera.", details: closeBody }, { status: closeRes.status });
        }

        console.log(`✅ [Transfeera Approval] Lote aprovado e finalizado! batch_id=${transfeeraBatchId}`);

        // 8. Atualizar status do lote no Supabase
        await supabase
            .from("lotes_saques")
            .update({ status: "PROCESSANDO" })
            .eq("id", lote_id);

        return NextResponse.json({
            closed: true,
            success: true,
            batch_id: transfeeraBatchId,
            items_count: successCount,
        });

    } catch (err: any) {
        console.error("Transfeera Approval API Error:", err);
        return NextResponse.json({ error: err.message || "Erro interno no servidor" }, { status: 500 });
    }
}
