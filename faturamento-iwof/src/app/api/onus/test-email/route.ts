import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

/**
 * GET /api/onus/test-email?to=email@exemplo.com
 * Endpoint de diagnóstico — testa o envio de e-mail em produção.
 * Remove este arquivo após confirmar que o e-mail funciona.
 */
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const to = searchParams.get("to");

    const diagnostics = {
        SMTP_HOST: process.env.SMTP_HOST || "smtp.gmail.com",
        SMTP_PORT: process.env.SMTP_PORT || "465",
        SMTP_USER_set: !!process.env.SMTP_USER,
        SMTP_PASS_set: !!process.env.SMTP_PASS,
        SMTP_USER_value: process.env.SMTP_USER ? process.env.SMTP_USER.replace(/(.{3}).*(@.*)/, "$1***$2") : null,
        nodemailer_version: require("nodemailer/package.json").version,
        to_provided: !!to,
    };

    if (!to) {
        return NextResponse.json({
            message: "Passe ?to=email@exemplo.com para testar o envio",
            diagnostics,
        });
    }

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        return NextResponse.json({
            error: "SMTP_USER ou SMTP_PASS não configurados",
            diagnostics,
        }, { status: 500 });
    }

    try {
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp.gmail.com",
            port: Number(process.env.SMTP_PORT) || 465,
            secure: (Number(process.env.SMTP_PORT) || 465) === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });

        // Verifica a conexão antes de enviar
        await transporter.verify();

        await transporter.sendMail({
            from: `"iWof Diagnóstico" <${process.env.SMTP_USER}>`,
            to,
            subject: "✅ Teste de E-mail — iWof Funcionando",
            html: `<p>Este é um e-mail de diagnóstico enviado em <strong>${new Date().toLocaleString("pt-BR")}</strong>.</p><p>Se você recebeu isto, o sistema de e-mail está operacional.</p>`,
        });

        return NextResponse.json({
            success: true,
            message: `E-mail enviado para ${to}`,
            diagnostics,
        });
    } catch (err: any) {
        return NextResponse.json({
            error: err.message,
            code: err.code,
            command: err.command,
            diagnostics,
        }, { status: 500 });
    }
}
