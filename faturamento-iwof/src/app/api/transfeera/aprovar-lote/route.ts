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

        // ─── Busca paginada para superar o limite de 1.000 rows do PostgREST ─────
        console.log(`[AprovarLote] 🔍 Buscando itens APROVADOS do lote ${lote_id} | user: ${user.id}`);
        const PAGE_SIZE = 1000;
        let page = 0;
        let allItems: any[] = [];
        let fetchError = null;

        while (true) {
            const from = page * PAGE_SIZE;
            const to = from + PAGE_SIZE - 1;
            const { data: pageData, error: pageError } = await supabase
                .from("itens_saque")
                .select("*")
                .eq("lote_id", lote_id)
                .eq("status_item", "APROVADO")
                .range(from, to);

            if (pageError) { fetchError = pageError; break; }
            if (pageData && pageData.length > 0) allItems = allItems.concat(pageData);
            if (!pageData || pageData.length < PAGE_SIZE) break;
            page++;
        }

        if (fetchError) {
            console.error(`[AprovarLote] ❌ Erro ao buscar itens | lote: ${lote_id} | Mensagem: ${fetchError.message}`);
            return NextResponse.json({ error: "Erro ao buscar itens do lote." }, { status: 500 });
        }
        console.log(`[AprovarLote] ✅ ${allItems.length} itens APROVADOS carregados (${page + 1} página(s)) | lote: ${lote_id}`);

        const itensValidos = allItems.filter((item: any) => Number(item.valor) > 0);

        if (itensValidos.length === 0) {
            return NextResponse.json({ error: "Nenhum item válido (valor > 0) encontrado para envio." }, { status: 400 });
        }

        // ─── Pré-validação local: tipo PIX mapeável ────────────────────────────
        const TIPOS_PIX_VALIDOS = new Set(["EMAIL", "CPF", "CNPJ", "TELEFONE", "CHAVE_ALEATORIA", "EVP", "ALEATORIO"]);
        const itensComTipoInvalido = itensValidos.filter((item: any) => {
            const tipo = (item.tipo_pix || "").toUpperCase().trim();
            return !tipo || !TIPOS_PIX_VALIDOS.has(tipo);
        });

        if (itensComTipoInvalido.length > 0) {
            console.warn(`[AprovarLote] ⚠️ ${itensComTipoInvalido.length} item(ns) com tipo PIX inválido detectados. Marcando como BLOQUEADO...`);

            // Marca os itens inválidos como BLOQUEADO no banco
            const bloqueioPromises = itensComTipoInvalido.map((item: any) =>
                supabase
                    .from("itens_saque")
                    .update({
                        status_item: "BLOQUEADO",
                        motivo_bloqueio: `Tipo PIX inválido: "${item.tipo_pix || "(vazio)"}" — não reconhecido pela Transfeera`,
                    })
                    .eq("id", item.id)
            );
            await Promise.all(bloqueioPromises);

            return NextResponse.json({
                error: `${itensComTipoInvalido.length} item(ns) com tipo de chave PIX inválido foram bloqueados. Corrija-os e tente novamente.`,
                validation_errors: itensComTipoInvalido.map((item: any) => ({
                    id: item.id,
                    nome_usuario: item.nome_usuario,
                    cpf_favorecido: item.cpf_favorecido,
                    chave_pix: item.chave_pix,
                    tipo_pix: item.tipo_pix,
                    valor: item.valor,
                    motivo: `Tipo PIX "${item.tipo_pix || "(vazio)"}" não é aceito pela Transfeera`,
                })),
            }, { status: 400 });
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
            console.error("❌ [Transfeera Bulk] Erro ao criar batch — resposta completa da Transfeera:", JSON.stringify(batchBody, null, 2));

            // Tenta extrair itens específicos a partir de errors[] ou transfers[] na resposta
            // A Transfeera pode retornar paths como: "transfers[42].destination_bank_account.pix_key_type"
            const transfeeraErrors: any[] = batchBody.errors || batchBody.violations || [];
            const failedIndexes = new Set<number>();

            for (const err of transfeeraErrors) {
                // Ex: "transfers[42].destination_bank_account.pix_key_type"
                const match = (err.field || err.path || err.property || "").match(/transfers\[(\d+)\]/);
                if (match) failedIndexes.add(Number(match[1]));
            }

            // Também verifica se a própria resposta já tem os transfers com errors embutidos
            const transfersWithErrors = (batchBody.transfers || []).filter((t: any) =>
                t.error || t.errors || t.status === "ERRO" || t.status === "INVALID"
            );
            transfersWithErrors.forEach((t: any, idx: number) => {
                // Tenta achar pelo integration_id no payload original
                const originalIdx = transfersPayload.findIndex((p: any) => p.integration_id === t.integration_id);
                if (originalIdx !== -1) failedIndexes.add(originalIdx);
            });

            let validationErrors: any[] = [];

            if (failedIndexes.size > 0) {
                // Mapeia índices → itens originais
                const itensFalhos = [...failedIndexes]
                    .filter(idx => idx < itensValidos.length)
                    .map(idx => itensValidos[idx]);

                // Busca a mensagem de erro correspondente por transfer
                const errosPorIndex = new Map<number, string>();
                for (const err of transfeeraErrors) {
                    const match = (err.field || err.path || err.property || "").match(/transfers\[(\d+)\]/);
                    if (match) {
                        const idx = Number(match[1]);
                        errosPorIndex.set(idx, err.message || err.description || "Erro de validação Transfeera");
                    }
                }

                // Marca esses itens como BLOQUEADO no banco
                const bloqueioPromises = itensFalhos.map((item: any) => {
                    const idx = itensValidos.indexOf(item);
                    const motivo = errosPorIndex.get(idx) || batchBody.message || "Rejeitado pela Transfeera";
                    return supabase
                        .from("itens_saque")
                        .update({ status_item: "BLOQUEADO", motivo_bloqueio: `Transfeera: ${motivo}` })
                        .eq("id", item.id);
                });
                await Promise.all(bloqueioPromises);

                validationErrors = itensFalhos.map((item: any) => {
                    const idx = itensValidos.indexOf(item);
                    return {
                        id: item.id,
                        nome_usuario: item.nome_usuario,
                        cpf_favorecido: item.cpf_favorecido,
                        chave_pix: item.chave_pix,
                        tipo_pix: item.tipo_pix,
                        valor: item.valor,
                        motivo: errosPorIndex.get(idx) || batchBody.message || "Rejeitado pela Transfeera",
                    };
                });

                console.warn(`[AprovarLote] ⚠️ ${validationErrors.length} item(ns) identificados como inválidos pela Transfeera e marcados como BLOQUEADO.`);

                return NextResponse.json({
                    error: `A Transfeera rejeitou ${validationErrors.length} item(ns). Eles foram bloqueados — corrija e tente novamente.`,
                    validation_errors: validationErrors,
                    transfeera_raw: batchBody,
                }, { status: 400 });
            }

            // Fallback: Transfeera rejeitou mas não indicou itens específicos
            return NextResponse.json({
                error: "A Transfeera rejeitou o lote. Corrija os itens inválidos e tente novamente.",
                transfeera_error: batchBody.message || JSON.stringify(batchBody),
                transfeera_raw: batchBody,
            }, { status: 400 });
        }

        // ═══ PASSO 5: Fechamento e Atualização (Caminho Feliz) ════════════════
        const transfeeraBatchId = String(batchBody.id);

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
