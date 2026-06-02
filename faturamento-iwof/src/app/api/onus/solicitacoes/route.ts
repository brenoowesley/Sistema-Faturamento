import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
    try {
        const supabase = createAdminClient();
        const { searchParams } = new URL(req.url);

        const status = searchParams.get("status");
        const data_inicio = searchParams.get("data_inicio");
        const data_fim = searchParams.get("data_fim");

        let query = supabase
            .from("onus_solicitacoes")
            .select(`
                *,
                clientes:cliente_id (
                    id,
                    razao_social,
                    nome_fantasia,
                    nome_conta_azul,
                    cnpj
                )
            `)
            .order("created_at", { ascending: false });

        if (status) {
            query = query.eq("status", status);
        }

        if (data_inicio) {
            query = query.gte("created_at", data_inicio);
        }

        if (data_fim) {
            // Add end-of-day to include the full day
            query = query.lte("created_at", data_fim + "T23:59:59.999Z");
        }

        const { data, error } = await query;

        if (error) {
            console.error("Erro ao listar solicitações de ônus:", error);
            return NextResponse.json(
                { error: "Erro ao listar solicitações" },
                { status: 500 }
            );
        }

        return NextResponse.json({ data });
    } catch (err: any) {
        console.error("Erro na API onus/solicitacoes (GET):", err);
        return NextResponse.json(
            { error: err.message || "Erro interno" },
            { status: 500 }
        );
    }
}

export async function PUT(req: NextRequest) {
    try {
        const supabase = createAdminClient();
        const body = await req.json();
        const { id, acao } = body;

        if (!id) {
            return NextResponse.json(
                { error: "Campo 'id' é obrigatório" },
                { status: 400 }
            );
        }

        if (!acao || !["aprovar", "recusar", "editar"].includes(acao)) {
            return NextResponse.json(
                { error: "Campo 'acao' deve ser 'aprovar', 'recusar' ou 'editar'" },
                { status: 400 }
            );
        }

        // ─── APROVAR ───────────────────────────────────────────────
        if (acao === "aprovar") {
            const { tipo_ajuste, cliente_id, nome_loja, valor, descricao, ...otherFields } = body;

            if (!tipo_ajuste || !["ACRESCIMO", "DESCONTO"].includes(tipo_ajuste)) {
                return NextResponse.json(
                    { error: "Campo 'tipo_ajuste' deve ser 'ACRESCIMO' ou 'DESCONTO'" },
                    { status: 400 }
                );
            }

            // Build update payload for onus_solicitacoes
            const updatePayload: Record<string, any> = {
                status: "aprovado",
                tipo_ajuste,
                aprovado_em: new Date().toISOString(),
            };

            // Allow overriding fields during approval
            if (cliente_id !== undefined) updatePayload.cliente_id = cliente_id;
            if (nome_loja !== undefined) updatePayload.nome_loja = nome_loja;
            if (valor !== undefined) updatePayload.valor = valor;
            if (descricao !== undefined) updatePayload.descricao = descricao;

            // Remove control fields from otherFields before merging
            const { id: _id, acao: _acao, ...editableFields } = otherFields;
            Object.assign(updatePayload, editableFields);

            // Update the solicitação
            const { error: updateError } = await supabase
                .from("onus_solicitacoes")
                .update(updatePayload)
                .eq("id", id);

            if (updateError) {
                console.error("Erro ao aprovar solicitação:", updateError);
                return NextResponse.json(
                    { error: "Erro ao aprovar solicitação" },
                    { status: 500 }
                );
            }

            // Fetch the updated solicitação to get all data
            const { data: solicitacao, error: fetchError } = await supabase
                .from("onus_solicitacoes")
                .select("*")
                .eq("id", id)
                .single();

            if (fetchError || !solicitacao) {
                console.error("Erro ao buscar solicitação aprovada:", fetchError);
                return NextResponse.json(
                    { error: "Erro ao buscar dados da solicitação" },
                    { status: 500 }
                );
            }

            // Insert into ajustes_faturamento
            const { data: ajuste, error: ajusteError } = await supabase
                .from("ajustes_faturamento")
                .insert({
                    cliente_id: solicitacao.cliente_id,
                    tipo: tipo_ajuste,
                    valor: solicitacao.valor,
                    motivo: solicitacao.descricao,
                    nome_profissional: solicitacao.nome_usuario,
                    data_ocorrencia: solicitacao.data_agendamento,
                    status_aplicacao: false,
                })
                .select("id")
                .single();

            if (ajusteError) {
                console.error("Erro ao criar ajuste de faturamento:", ajusteError);
                return NextResponse.json(
                    { error: "Solicitação aprovada, mas erro ao gerar ajuste de faturamento" },
                    { status: 500 }
                );
            }

            // Link the ajuste back to the solicitação
            await supabase
                .from("onus_solicitacoes")
                .update({ ajuste_gerado_id: ajuste.id })
                .eq("id", id);

            return NextResponse.json({
                success: true,
                message: "Solicitação aprovada e ajuste gerado",
                ajuste_id: ajuste.id,
            });
        }

        // ─── RECUSAR ───────────────────────────────────────────────
        if (acao === "recusar") {
            const { motivo_recusa } = body;

            if (!motivo_recusa) {
                return NextResponse.json(
                    { error: "Campo 'motivo_recusa' é obrigatório para recusar" },
                    { status: 400 }
                );
            }

            const { error: updateError } = await supabase
                .from("onus_solicitacoes")
                .update({
                    status: "recusado",
                    motivo_recusa,
                    aprovado_em: new Date().toISOString(),
                })
                .eq("id", id);

            if (updateError) {
                console.error("Erro ao recusar solicitação:", updateError);
                return NextResponse.json(
                    { error: "Erro ao recusar solicitação" },
                    { status: 500 }
                );
            }

            return NextResponse.json({
                success: true,
                message: "Solicitação recusada",
            });
        }

        // ─── EDITAR ────────────────────────────────────────────────
        if (acao === "editar") {
            // Extract only editable fields (exclude control fields)
            const { id: _id, acao: _acao, ...fieldsToUpdate } = body;

            if (Object.keys(fieldsToUpdate).length === 0) {
                return NextResponse.json(
                    { error: "Nenhum campo para atualizar" },
                    { status: 400 }
                );
            }

            const { error: updateError } = await supabase
                .from("onus_solicitacoes")
                .update({
                    ...fieldsToUpdate,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", id);

            if (updateError) {
                console.error("Erro ao editar solicitação:", updateError);
                return NextResponse.json(
                    { error: "Erro ao editar solicitação" },
                    { status: 500 }
                );
            }

            return NextResponse.json({
                success: true,
                message: "Solicitação atualizada",
            });
        }
    } catch (err: any) {
        console.error("Erro na API onus/solicitacoes (PUT):", err);
        return NextResponse.json(
            { error: err.message || "Erro interno" },
            { status: 500 }
        );
    }
}
