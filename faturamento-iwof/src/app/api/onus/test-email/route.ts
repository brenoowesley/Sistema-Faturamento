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
        EMAIL_USER_set: !!process.env.EMAIL_USER,
        EMAIL_PASS_set: !!process.env.EMAIL_PASS,
        EMAIL_USER_value: process.env.EMAIL_USER ? process.env.EMAIL_USER.replace(/(.{3}).*(@.*)/, "$1***$2") : null,
        nodemailer_version: require("nodemailer/package.json").version,
        to_provided: !!to,
    };

    if (!to) {
        return NextResponse.json({
            message: "Passe ?to=email@exemplo.com para testar o envio",
            diagnostics,
        });
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        return NextResponse.json({
            error: "EMAIL_USER ou EMAIL_PASS não configurados",
            diagnostics,
        }, { status: 500 });
    }

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

        // Verifica a conexão antes de enviar
        await transporter.verify();

        await transporter.sendMail({
            from: `"iWof Diagnóstico" <${process.env.EMAIL_USER}>`,
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
