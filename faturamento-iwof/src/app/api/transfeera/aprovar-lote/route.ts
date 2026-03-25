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

        if (!items || items.length === 0) {
            return NextResponse.json({ error: "Nenhum item aprovado encontrado neste lote." }, { status: 400 });
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

        // 5. PASSO 2: Adicionar transferências no lote criado
        const transfers = items.map((item) => ({
            value: item.valor,
            integration_id: item.id,
            favored_name: item.nome_usuario,
            favored_cpf_cnpj: item.cpf_favorecido.replace(/\D/g, ""),
            pix_key: formatarChavePix(item.tipo_pix, item.chave_pix),
            pix_key_type: normalizePixKeyType(item.tipo_pix),
            pix_description: "REPASSE IWOF",
        }));

        const transfersRes = await fetch(`${baseUrl}/batch/${transfeeraBatchId}/transfer`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": UA_HEADER,
            },
            body: JSON.stringify({ transfers }),
        });

        const transfersBody = await transfersRes.json();
        if (!transfersRes.ok) {
            console.error(`[Transfeera Approval] Erro ao adicionar transferências:`, JSON.stringify(transfersBody));
            return NextResponse.json({ error: "Erro ao adicionar transferências no lote.", details: transfersBody }, { status: transfersRes.status });
        }

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
        // A Transfeera retorna as transferências após adicioná-las
        const transfersList = transfersBody.transfers || [];
        if (transfersList.length > 0) {
            const updatePromises = transfersList.map((t: any) => {
                if (!t.integration_id || !t.id) return Promise.resolve();
                return supabase
                    .from("itens_saque")
                    .update({ transfeera_transfer_id: String(t.id) })
                    .eq("id", t.integration_id);
            });
            await Promise.all(updatePromises);
        }

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
            items_count: items.length
        });

    } catch (err: any) {
        console.error("Transfeera Approval API Error:", err);
        return NextResponse.json({ error: err.message || "Erro interno no servidor" }, { status: 500 });
    }
}
