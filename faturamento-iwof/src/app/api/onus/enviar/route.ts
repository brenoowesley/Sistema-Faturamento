import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

function parseValor(valorStr: string): number {
    // Remove "R$", spaces, dots (thousands separator), replace comma with dot
    const cleaned = valorStr
        .replace(/R\$\s?/g, "")
        .replace(/\s/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
    const parsed = parseFloat(cleaned);
    if (isNaN(parsed)) {
        throw new Error(`Valor inválido: "${valorStr}"`);
    }
    return parsed;
}

function buildConfirmationEmail(data: {
    nome_usuario: string;
    nome_loja: string;
    cnpj_loja: string;
    data_agendamento: string;
    descricao: string;
    valor: number;
    canal_recebimento: string;
    canal_link?: string;
    anexo_url?: string;
}): string {
    const formatCurrency = (v: number) =>
        v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

    const canalLabel: Record<string, string> = {
        tasky: "Tasky",
        email: "E-mail",
        formulario: "Formulário",
        outros: "Outros",
    };

    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background-color:#f4f6f9;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
        <tr>
            <td style="background-color:#1c5d99;padding:28px 32px;text-align:center;">
                <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:600;">
                    Solicitação de Ônus Recebida
                </h1>
                <p style="color:#d1e3f6;margin:8px 0 0;font-size:14px;">
                    iWof — Sistema de Faturamento
                </p>
            </td>
        </tr>
        <tr>
            <td style="background-color:#ffffff;padding:32px;">
                <p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 20px;">
                    Olá <strong>${data.nome_usuario}</strong>, sua solicitação de ônus foi recebida com sucesso e está em análise pela equipe financeira.
                </p>

                <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
                    <tr style="background-color:#f8fafc;">
                        <td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;width:40%;border-bottom:1px solid #e2e8f0;">Loja</td>
                        <td style="padding:12px 16px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${data.nome_loja}</td>
                    </tr>
                    <tr>
                        <td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">CNPJ</td>
                        <td style="padding:12px 16px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${data.cnpj_loja}</td>
                    </tr>
                    <tr style="background-color:#f8fafc;">
                        <td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Data do Agendamento</td>
                        <td style="padding:12px 16px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${data.data_agendamento}</td>
                    </tr>
                    <tr>
                        <td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Descrição</td>
                        <td style="padding:12px 16px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${data.descricao}</td>
                    </tr>
                    <tr style="background-color:#f8fafc;">
                        <td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Valor</td>
                        <td style="padding:12px 16px;font-size:14px;color:#1e293b;font-weight:600;border-bottom:1px solid #e2e8f0;">${formatCurrency(data.valor)}</td>
                    </tr>
                    <tr>
                        <td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Canal de Recebimento</td>
                        <td style="padding:12px 16px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${canalLabel[data.canal_recebimento] || data.canal_recebimento}</td>
                    </tr>
                    ${data.canal_link ? `
                    <tr style="background-color:#f8fafc;">
                        <td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Link do Canal</td>
                        <td style="padding:12px 16px;font-size:14px;border-bottom:1px solid #e2e8f0;">
                            <a href="${data.canal_link}" style="color:#1c5d99;text-decoration:underline;">${data.canal_link}</a>
                        </td>
                    </tr>` : ""}
                    ${data.anexo_url ? `
                    <tr>
                        <td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;">Anexo</td>
                        <td style="padding:12px 16px;font-size:14px;">
                            <a href="${data.anexo_url}" style="color:#1c5d99;text-decoration:underline;">📎 Ver anexo</a>
                        </td>
                    </tr>` : ""}
                </table>

                <p style="color:#64748b;font-size:13px;line-height:1.5;margin:24px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;">
                    Você receberá uma notificação quando sua solicitação for analisada. Em caso de dúvidas, entre em contato com a equipe financeira.
                </p>
            </td>
        </tr>
        <tr>
            <td style="background-color:#f1f5f9;padding:16px 32px;text-align:center;">
                <p style="color:#94a3b8;font-size:12px;margin:0;">
                    © ${new Date().getFullYear()} iWof — Este é um e-mail automático, não responda.
                </p>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();

        // Extract and validate required fields
        const cnpj_loja = formData.get("cnpj_loja") as string;
        const nome_loja = formData.get("nome_loja") as string;
        const nome_usuario = formData.get("nome_usuario") as string;
        const data_agendamento = formData.get("data_agendamento") as string;
        const descricao = formData.get("descricao") as string;
        const valorStr = formData.get("valor") as string;
        const canal_recebimento = formData.get("canal_recebimento") as string;
        const canal_link = (formData.get("canal_link") as string) || null;
        const email_solicitante = (formData.get("email_solicitante") as string) || null;
        const anexo = formData.get("anexo") as File | null;

        // Validate required fields
        const requiredFields: Record<string, string | null> = {
            cnpj_loja,
            nome_loja,
            nome_usuario,
            data_agendamento,
            descricao,
            valor: valorStr,
            canal_recebimento,
        };

        const missing = Object.entries(requiredFields)
            .filter(([, value]) => !value)
            .map(([key]) => key);

        if (missing.length > 0) {
            return NextResponse.json(
                { error: `Campos obrigatórios faltando: ${missing.join(", ")}` },
                { status: 400 }
            );
        }

        // Validate canal_recebimento
        const canaisValidos = ["tasky", "email", "formulario", "outros"];
        if (!canaisValidos.includes(canal_recebimento)) {
            return NextResponse.json(
                { error: `Canal de recebimento inválido. Use: ${canaisValidos.join(", ")}` },
                { status: 400 }
            );
        }

        // Validate canal_link is provided when canal is tasky
        if (canal_recebimento === "tasky" && !canal_link) {
            return NextResponse.json(
                { error: "Link do canal é obrigatório quando o canal é 'tasky'" },
                { status: 400 }
            );
        }

        // Parse valor
        const valor = parseValor(valorStr);

        const supabase = createAdminClient();

        // Upload anexo if provided
        let anexo_url: string | null = null;

        if (anexo && anexo.size > 0) {
            try {
                const BUCKET = "onus-anexos";

                // Garante que o bucket existe (cria se não existir)
                const { error: bucketError } = await supabase.storage.createBucket(BUCKET, {
                    public: true,
                    fileSizeLimit: 10 * 1024 * 1024, // 10 MB
                    allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/jpg"],
                });

                // Ignora erro se bucket já existe (código 409 / "already exists")
                if (bucketError && !bucketError.message.includes("already exists")) {
                    console.warn("Aviso ao criar bucket:", bucketError.message);
                }

                const timestamp = Date.now();
                const safeFilename = anexo.name.replace(/[^a-zA-Z0-9._-]/g, "_");
                const filePath = `${timestamp}_${safeFilename}`;
                const buffer = Buffer.from(await anexo.arrayBuffer());

                const { error: uploadError } = await supabase.storage
                    .from(BUCKET)
                    .upload(filePath, buffer, {
                        contentType: anexo.type || "application/octet-stream",
                        upsert: false,
                    });

                if (uploadError) {
                    // Não bloqueia o envio — loga e continua sem anexo
                    console.error("Falha no upload do anexo (não bloqueante):", uploadError.message);
                } else {
                    const { data: publicUrlData } = supabase.storage
                        .from(BUCKET)
                        .getPublicUrl(filePath);
                    anexo_url = publicUrlData.publicUrl;
                }
            } catch (uploadErr: any) {
                console.error("Erro inesperado no upload do anexo:", uploadErr?.message);
            }
        }

        // Auto-match cliente by CNPJ
        const cleanCnpj = cnpj_loja.replace(/\D/g, "");
        let cliente_id: string | null = null;
        let loja_identificada = false;

        if (cleanCnpj.length > 0) {
            const { data: cliente } = await supabase
                .from("clientes")
                .select("id")
                .eq("cnpj", cleanCnpj)
                .maybeSingle();

            if (cliente) {
                cliente_id = cliente.id;
                loja_identificada = true;
            }
        }

        // Insert into onus_solicitacoes
        const { data: inserted, error: insertError } = await supabase
            .from("onus_solicitacoes")
            .insert({
                cnpj_loja: cleanCnpj,
                nome_loja,
                nome_usuario,
                data_agendamento,
                descricao,
                valor,
                canal_recebimento,
                canal_link,
                email_solicitante,
                anexo_url,
                cliente_id,
                loja_identificada,
                status: "pendente",
            })
            .select("id")
            .single();

        if (insertError) {
            console.error("Erro ao inserir solicitação de ônus:", insertError);
            return NextResponse.json(
                {
                    error: "Erro ao registrar solicitação",
                    detail: insertError.message,
                    code: insertError.code,
                    hint: insertError.hint ?? null,
                },
                { status: 500 }
            );
        }

        // Send confirmation email if email_solicitante provided
        if (email_solicitante) {
            try {
                const transporter = nodemailer.createTransport({
                    host: "smtp.gmail.com",
                    port: 465,
                    secure: true,
                    auth: {
                        user: process.env.EMAIL_USER,
                        pass: process.env.EMAIL_PASS,
                    },
                });

                const htmlContent = buildConfirmationEmail({
                    nome_usuario,
                    nome_loja,
                    cnpj_loja,
                    data_agendamento,
                    descricao,
                    valor,
                    canal_recebimento,
                    canal_link: canal_link || undefined,
                    anexo_url: anexo_url || undefined,
                });

                await transporter.sendMail({
                    from: `"iWof Financeiro" <${process.env.EMAIL_USER}>`,
                    to: email_solicitante,
                    subject: "Solicitação de Ônus Recebida — iWof",
                    html: htmlContent,
                });

                console.log(`E-mail de confirmação enviado para ${email_solicitante}`);
            } catch (emailErr) {
                // Don't fail the request if email fails — log and continue
                console.error("Erro ao enviar e-mail de confirmação:", emailErr);
            }
        }

        return NextResponse.json({ success: true, id: inserted.id });
    } catch (err: any) {
        console.error("Erro na API onus/enviar:", err);
        return NextResponse.json(
            { error: err.message || "Erro interno" },
            { status: 500 }
        );
    }
}
