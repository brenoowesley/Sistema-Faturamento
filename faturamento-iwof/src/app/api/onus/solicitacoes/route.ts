import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

/* ─────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────── */

const fmtCurrency = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (d: string) =>
    d ? new Date(d).toLocaleDateString("pt-BR") : "-";

function createTransporter() {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: Number(process.env.SMTP_PORT) || 465,
        secure: (Number(process.env.SMTP_PORT) || 465) === 465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
}

/** Envia e-mail de forma não-bloqueante. Não lança erro — apenas loga. */
async function sendEmail(to: string, subject: string, html: string) {
    if (!to || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.log(`[email] Skipped — to="${to}" SMTP_USER=${!!process.env.SMTP_USER} SMTP_PASS=${!!process.env.SMTP_PASS}`);
        return;
    }
    try {
        const transporter = createTransporter();
        await transporter.sendMail({
            from: `"iWof Financeiro" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html,
        });
        console.log(`[email] Enviado para ${to}: ${subject}`);
    } catch (err: any) {
        console.error(`[email] Falha ao enviar para ${to}:`, err?.message);
    }
}

/* ─────────────────────────────────────────────────────────────
   TEMPLATES DE E-MAIL
   ───────────────────────────────────────────────────────────── */

// Logo iWof — mesmo usado na Sidebar (PNG hospedado no Imgur)
// Claro (fundo colorido): https://i.imgur.com/ag93VEM.png
// Escuro (fundo branco):  https://i.imgur.com/MKGrpJX.png
const IWOF_LOGO_IMG = `<img src="https://i.imgur.com/ag93VEM.png" alt="iWof" style="height:36px;width:auto;display:block;">`;
const IWOF_LOGO_IMG_DARK = `<img src="https://i.imgur.com/MKGrpJX.png" alt="iWof" style="height:32px;width:auto;display:block;">`;

function logoBar(accentColor: string) {
    return `<tr>
      <td style="background:${accentColor};padding:20px 32px 0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align:left;">${IWOF_LOGO_IMG}</td>
            <td style="text-align:right;">
              <span style="color:rgba(255,255,255,0.55);font-size:11px;font-family:'Segoe UI',sans-serif;letter-spacing:0.05em;text-transform:uppercase;">Sistema de Faturamento</span>
            </td>
          </tr>
        </table>
        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin:16px 0 0;">
      </td>
    </tr>`;
}

function header(title: string, subtitle: string, color = "#1c5d99") {
    return `${logoBar(color)}
    <tr><td style="background:${color};padding:24px 32px 28px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;line-height:1.3;">${title}</h1>
        <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">${subtitle}</p>
    </td></tr>`;
}

function row(label: string, value: string, bg = "#fff") {
    return `
    <tr style="background:${bg};">
        <td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;width:40%;border-bottom:1px solid #e2e8f0;">${label}</td>
        <td style="padding:12px 16px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${value}</td>
    </tr>`;
}

function wrapEmail(headerRows: string, bodyHtml: string) {
    const year = new Date().getFullYear();
    return `<!DOCTYPE html><html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"
><title>iWof — Notificação</title></head>
<body style="margin:0;padding:24px 0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">
      ${headerRows}
      <tr><td style="background:#ffffff;padding:32px;">${bodyHtml}</td></tr>
      <tr><td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>${IWOF_LOGO_IMG_DARK}</td>
            <td style="text-align:right;vertical-align:middle;">
              <p style="color:#94a3b8;font-size:11px;margin:0;line-height:1.5;">© ${year} iWof Tecnologia<br>E-mail automático — não responda.</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function buildAprovacaoEmail(sol: any): string {
    const h = header("✅ Solicitação de Ônus Aprovada", "iWof — Sistema de Faturamento", "#0f6b35");
    const body = `
        <p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 20px;">
            Olá <strong>${sol.nome_usuario}</strong>, sua solicitação de ônus foi <strong>aprovada</strong> e será considerada no próximo fechamento de faturamento.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            ${row("Loja", sol.nome_loja, "#f8fafc")}
            ${row("CNPJ", sol.cnpj_loja)}
            ${row("Data Agendada", fmtDate(sol.data_agendamento), "#f8fafc")}
            ${row("Descrição", sol.descricao)}
            ${row("Valor", fmtCurrency(sol.valor), "#f8fafc")}
            ${sol.observacao_admin ? row("Obs. da Equipe", sol.observacao_admin) : ""}
        </table>
        <p style="color:#64748b;font-size:13px;line-height:1.5;margin:24px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;">
            O ajuste foi registrado e será aplicado no próximo ciclo de faturamento. Em caso de dúvidas, entre em contato com a equipe financeira.
        </p>`;
    return wrapEmail(h, body);
}

function buildRecusaEmail(sol: any): string {
    const h = header("❌ Solicitação de Ônus Recusada", "iWof — Sistema de Faturamento", "#991b1b");
    const body = `
        <p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 20px;">
            Olá <strong>${sol.nome_usuario}</strong>, infelizmente sua solicitação de ônus foi <strong>recusada</strong> pela equipe financeira.
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            ${row("Loja", sol.nome_loja, "#f8fafc")}
            ${row("Descrição", sol.descricao)}
            ${row("Valor Solicitado", fmtCurrency(sol.valor), "#f8fafc")}
            ${row("Motivo da Recusa", `<span style="color:#dc2626;font-weight:600;">${sol.motivo_recusa}</span>`)}
        </table>
        <p style="color:#64748b;font-size:13px;line-height:1.5;margin:24px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;">
            Se tiver dúvidas sobre esta decisão, entre em contato com a equipe financeira para mais esclarecimentos.
        </p>`;
    return wrapEmail(h, body);
}

/* ─────────────────────────────────────────────────────────────
   GET — listar solicitações
   ───────────────────────────────────────────────────────────── */

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

        if (status) query = query.eq("status", status);
        if (data_inicio) query = query.gte("created_at", data_inicio);
        if (data_fim) query = query.lte("created_at", data_fim + "T23:59:59.999Z");

        const { data, error } = await query;

        if (error) {
            console.error("Erro ao listar solicitações de ônus:", error);
            return NextResponse.json({ error: "Erro ao listar solicitações" }, { status: 500 });
        }

        return NextResponse.json({ data });
    } catch (err: any) {
        console.error("Erro na API onus/solicitacoes (GET):", err);
        return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 });
    }
}

/* ─────────────────────────────────────────────────────────────
   PUT — aprovar / recusar / editar
   ───────────────────────────────────────────────────────────── */

export async function PUT(req: NextRequest) {
    try {
        const supabase = createAdminClient();
        const body = await req.json();
        const { id, acao } = body;

        if (!id) {
            return NextResponse.json({ error: "Campo 'id' é obrigatório" }, { status: 400 });
        }

        if (!acao || !["aprovar", "recusar", "editar"].includes(acao)) {
            return NextResponse.json(
                { error: "Campo 'acao' deve ser 'aprovar', 'recusar' ou 'editar'" },
                { status: 400 }
            );
        }

        // ─── APROVAR ──────────────────────────────────────────────
        if (acao === "aprovar") {
            const { tipo_ajuste, cliente_id, nome_loja, valor, descricao, observacao_admin, ...otherFields } = body;

            if (!tipo_ajuste || !["ACRESCIMO", "DESCONTO"].includes(tipo_ajuste)) {
                return NextResponse.json(
                    { error: "Campo 'tipo_ajuste' deve ser 'ACRESCIMO' ou 'DESCONTO'" },
                    { status: 400 }
                );
            }

            const updatePayload: Record<string, any> = {
                status: "aprovado",
                tipo_ajuste,
                aprovado_em: new Date().toISOString(),
            };

            if (cliente_id !== undefined) updatePayload.cliente_id = cliente_id;
            if (nome_loja !== undefined) updatePayload.nome_loja = nome_loja;
            if (valor !== undefined) updatePayload.valor = valor;
            if (descricao !== undefined) updatePayload.descricao = descricao;
            if (observacao_admin !== undefined) updatePayload.observacao_admin = observacao_admin;

            const { id: _id, acao: _acao, ...editableFields } = otherFields;
            Object.assign(updatePayload, editableFields);

            const { error: updateError } = await supabase
                .from("onus_solicitacoes")
                .update(updatePayload)
                .eq("id", id);

            if (updateError) {
                console.error("Erro ao aprovar solicitação:", updateError);
                return NextResponse.json({ error: "Erro ao aprovar solicitação" }, { status: 500 });
            }

            // Busca solicitação atualizada (com email_solicitante)
            const { data: solicitacao, error: fetchError } = await supabase
                .from("onus_solicitacoes")
                .select("*")
                .eq("id", id)
                .single();

            if (fetchError || !solicitacao) {
                console.error("Erro ao buscar solicitação aprovada:", fetchError);
                return NextResponse.json({ error: "Erro ao buscar dados da solicitação" }, { status: 500 });
            }

            // Cria ajuste no faturamento
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

            // Vincula ajuste à solicitação
            await supabase
                .from("onus_solicitacoes")
                .update({ ajuste_gerado_id: ajuste.id })
                .eq("id", id);

            // ✉️ E-mail de aprovação (não-bloqueante, só se email preenchido)
            if (solicitacao.email_solicitante) {
                await sendEmail(
                    solicitacao.email_solicitante,
                    "✅ Solicitação de Ônus Aprovada — iWof",
                    buildAprovacaoEmail({ ...solicitacao, observacao_admin })
                );
            }

            return NextResponse.json({
                success: true,
                message: "Solicitação aprovada e ajuste gerado",
                ajuste_id: ajuste.id,
            });
        }

        // ─── RECUSAR ──────────────────────────────────────────────
        if (acao === "recusar") {
            const { motivo_recusa } = body;

            if (!motivo_recusa) {
                return NextResponse.json(
                    { error: "Campo 'motivo_recusa' é obrigatório para recusar" },
                    { status: 400 }
                );
            }

            // Busca email_solicitante ANTES de atualizar
            const { data: solicitacao } = await supabase
                .from("onus_solicitacoes")
                .select("*")
                .eq("id", id)
                .single();

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
                return NextResponse.json({ error: "Erro ao recusar solicitação" }, { status: 500 });
            }

            // ✉️ E-mail de recusa (não-bloqueante, só se email preenchido)
            if (solicitacao?.email_solicitante) {
                await sendEmail(
                    solicitacao.email_solicitante,
                    "❌ Solicitação de Ônus Recusada — iWof",
                    buildRecusaEmail({ ...solicitacao, motivo_recusa })
                );
            }

            return NextResponse.json({ success: true, message: "Solicitação recusada" });
        }

        // ─── EDITAR ───────────────────────────────────────────────
        if (acao === "editar") {
            const { id: _id, acao: _acao, ...fieldsToUpdate } = body;

            if (Object.keys(fieldsToUpdate).length === 0) {
                return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 });
            }

            const { error: updateError } = await supabase
                .from("onus_solicitacoes")
                .update({ ...fieldsToUpdate, updated_at: new Date().toISOString() })
                .eq("id", id);

            if (updateError) {
                console.error("Erro ao editar solicitação:", updateError);
                return NextResponse.json({ error: "Erro ao editar solicitação" }, { status: 500 });
            }

            return NextResponse.json({ success: true, message: "Solicitação atualizada" });
        }
    } catch (err: any) {
        console.error("Erro na API onus/solicitacoes (PUT):", err);
        return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 });
    }
}
