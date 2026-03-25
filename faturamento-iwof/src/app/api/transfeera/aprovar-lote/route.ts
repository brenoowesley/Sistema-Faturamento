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

        // 2. Consultar itens aprovados
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
            return NextResponse.json({ error: "Nenhum item com valor superior a R$ 0,00 encontrado." }, { status: 400 });
        }

        // 3. Autenticar com Transfeera
        const token = await getTransfeeraToken();
        const baseUrl = getTransfeeraBaseUrl();

        // 4. PASSO 1: Criar o lote na Transfeera
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

        const transfeeraBatchId = String(batchBody.id);

        // 5. PASSO 2: Adicionar cada transferência individualmente no lote criado
        // Conforme solicitado: utilizar Promise.all para envio individual na raiz do body
        const transferResponses = await Promise.all(itensValidos.map(async (item: any) => {
            const payload = {
                value: Number(item.valor),
                integration_id: String(item.id),
                favored_name: item.nome_usuario,
                favored_cpf_cnpj: item.cpf_favorecido.replace(/\D/g, ""),
                pix_key: formatarChavePix(item.tipo_pix, item.chave_pix),
                pix_key_type: normalizePixKeyType(item.tipo_pix),
                pix_description: "REPASSE IWOF"
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
                console.error(`[Transfeera Approval] Erro no item ${item.id}:`, JSON.stringify(tBody));
                throw new Error(`Erro na transferência do trabalhador ${item.nome_usuario}: ${tBody.message || "Erro desconhecido"}`);
            }

            return {
                integration_id: item.id,
                transfeera_id: String(tBody.id)
            };
        }));

        // 6. PASSO 3: Fechar o lote na Transfeera
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

        // 7. Atualizar IDs das transferências no Supabase
        const updatePromises = transferResponses.map((t: any) => {
            return supabase
                .from("itens_saque")
                .update({ transfeera_transfer_id: t.transfeera_id })
                .eq("id", t.integration_id);
        });
        await Promise.all(updatePromises);

        // 8. Atualizar status do lote no Supabase
        const { error: updateLoteError } = await supabase
            .from("lotes_saques")
            .update({
                status: "PROCESSANDO",
                transfeera_batch_id: transfeeraBatchId,
            })
            .eq("id", lote_id);

        if (updateLoteError) {
            return NextResponse.json({ error: "Lote finalizado, mas erro ao atualizar status no banco." }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            batch_id: transfeeraBatchId,
            items_count: itensValidos.length
        });

    } catch (err: any) {
        console.error("Transfeera Approval API Error:", err);
        return NextResponse.json({ error: err.message || "Erro interno no servidor" }, { status: 500 });
    }
}
