/**
 * Script de teste de e-mail — executa localmente com as env vars do .env.local
 * Uso: node test-email-local.mjs
 */

import { createRequire } from "module";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Carrega .env.local manualmente
function loadEnv(filePath) {
    try {
        const content = readFileSync(filePath, "utf-8");
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx === -1) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
            process.env[key] = val;
        }
        console.log("✅ .env.local carregado");
    } catch {
        console.log("⚠️  .env.local não encontrado — usando env vars do sistema");
    }
}

loadEnv(path.join(__dirname, ".env.local"));

const require = createRequire(import.meta.url);
const nodemailer = require("./node_modules/nodemailer");
const pkg = require("./node_modules/nodemailer/package.json");

// ─── CONFIG ─────────────────────────────────────────────────────
const EMAIL_USER = process.env.SMTP_USER;
const EMAIL_PASS = process.env.SMTP_PASS;
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TARGET_EMAIL = "breno@iwof.com.br";
const TARGET_CNPJ  = "48999300000152";

// ─── DIAGNÓSTICO ────────────────────────────────────────────────
console.log("\n📋 DIAGNÓSTICO:");
console.log(`  nodemailer version : ${pkg.version}`);
console.log(`  SMTP_HOST          : ${SMTP_HOST}`);
console.log(`  SMTP_PORT          : ${SMTP_PORT}`);
console.log(`  SMTP_USER          : ${EMAIL_USER ? EMAIL_USER.replace(/(.{3}).*(@.*)/, "$1***$2") : "❌ NÃO CONFIGURADO"}`);
console.log(`  SMTP_PASS          : ${EMAIL_PASS ? "✅ configurado" : "❌ NÃO CONFIGURADO"}`);
console.log(`  SUPABASE_URL       : ${SUPABASE_URL ? "✅ configurado" : "❌ NÃO CONFIGURADO"}`);
console.log("");

if (!EMAIL_USER || !EMAIL_PASS) {
    console.error("❌ EMAIL_USER ou EMAIL_PASS não configurados. Abortando.\n");
    process.exit(1);
}

// ─── HELPERS ────────────────────────────────────────────────────
const fmtCurrency = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("pt-BR") : "-";

function wrapEmail(headerHtml, bodyHtml) {
    return `<!DOCTYPE html><html lang="pt-BR"><body style="margin:0;padding:0;font-family:'Segoe UI',sans-serif;background:#f4f6f9;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
        <tr>${headerHtml}</tr>
        <tr><td style="background:#fff;padding:32px;">${bodyHtml}</td></tr>
        <tr><td style="background:#f1f5f9;padding:16px 32px;text-align:center;"><p style="color:#94a3b8;font-size:12px;margin:0;">© ${new Date().getFullYear()} iWof — E-mail automático de teste.</p></td></tr>
    </table></body></html>`;
}

function row(label, value, bg = "#fff") {
    return `<tr style="background:${bg};"><td style="padding:12px 16px;font-size:13px;color:#64748b;font-weight:600;width:40%;border-bottom:1px solid #e2e8f0;">${label}</td><td style="padding:12px 16px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${value}</td></tr>`;
}

// ─── DADOS SIMULADOS ────────────────────────────────────────────
const solicitacaoSimulada = {
    nome_usuario: "Breno (Teste)",
    nome_loja: "Loja Teste iWof",
    cnpj_loja: TARGET_CNPJ,
    data_agendamento: new Date().toISOString().split("T")[0],
    descricao: "Teste de integração do sistema de e-mails — simulação de ônus",
    valor: 150.00,
    canal_recebimento: "tasky",
    email_solicitante: TARGET_EMAIL,
    observacao_admin: "Aprovado como teste de diagnóstico",
    motivo_recusa: "Motivo simulado para teste de recusa",
};

// ─── TEMPLATES ──────────────────────────────────────────────────
function buildRecebimentoEmail(sol) {
    const h = `<td style="background:#1c5d99;padding:28px 32px;text-align:center;"><h1 style="color:#fff;margin:0;font-size:22px;">📨 Solicitação de Ônus Recebida</h1><p style="color:rgba(255,255,255,.75);margin:8px 0 0;font-size:14px;">iWof — Sistema de Faturamento</p></td>`;
    const body = `<p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 20px;">Olá <strong>${sol.nome_usuario}</strong>, sua solicitação foi recebida e está em análise.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        ${row("Loja", sol.nome_loja, "#f8fafc")}
        ${row("CNPJ", sol.cnpj_loja)}
        ${row("Data Agendada", fmtDate(sol.data_agendamento), "#f8fafc")}
        ${row("Descrição", sol.descricao)}
        ${row("Valor", fmtCurrency(sol.valor), "#f8fafc")}
    </table>`;
    return wrapEmail(h, body);
}

function buildAprovacaoEmail(sol) {
    const h = `<td style="background:#0f6b35;padding:28px 32px;text-align:center;"><h1 style="color:#fff;margin:0;font-size:22px;">✅ Solicitação de Ônus Aprovada</h1><p style="color:rgba(255,255,255,.75);margin:8px 0 0;font-size:14px;">iWof — Sistema de Faturamento</p></td>`;
    const body = `<p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 20px;">Olá <strong>${sol.nome_usuario}</strong>, sua solicitação foi <strong>aprovada</strong> e será aplicada no próximo fechamento.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        ${row("Loja", sol.nome_loja, "#f8fafc")}
        ${row("Valor", fmtCurrency(sol.valor))}
        ${row("Obs. da Equipe", sol.observacao_admin, "#f8fafc")}
    </table>`;
    return wrapEmail(h, body);
}

function buildRecusaEmail(sol) {
    const h = `<td style="background:#991b1b;padding:28px 32px;text-align:center;"><h1 style="color:#fff;margin:0;font-size:22px;">❌ Solicitação de Ônus Recusada</h1><p style="color:rgba(255,255,255,.75);margin:8px 0 0;font-size:14px;">iWof — Sistema de Faturamento</p></td>`;
    const body = `<p style="color:#333;font-size:15px;line-height:1.6;margin:0 0 20px;">Olá <strong>${sol.nome_usuario}</strong>, sua solicitação foi <strong>recusada</strong>.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        ${row("Loja", sol.nome_loja, "#f8fafc")}
        ${row("Motivo da Recusa", `<span style="color:#dc2626;font-weight:600;">${sol.motivo_recusa}</span>`)}
    </table>`;
    return wrapEmail(h, body);
}

// ─── ENVIO ──────────────────────────────────────────────────────
async function sendTest(label, subject, html) {
    console.log(`\n📤 Testando: ${label}`);
    try {
        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_PORT === 465,
            auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        });

        console.log("  🔌 Verificando conexão SMTP...");
        await transporter.verify();
        console.log("  ✅ SMTP conectado");

        await transporter.sendMail({
            from: `"iWof Diagnóstico" <${EMAIL_USER}>`,
            to: TARGET_EMAIL,
            subject,
            html,
        });

        console.log(`  ✅ E-mail enviado → ${TARGET_EMAIL}`);
        return true;
    } catch (err) {
        console.error(`  ❌ FALHA: ${err.message}`);
        if (err.code) console.error(`     Código: ${err.code}`);
        if (err.command) console.error(`     Comando SMTP: ${err.command}`);
        return false;
    }
}

// ─── EXECUÇÃO ───────────────────────────────────────────────────
(async () => {
    console.log(`\n🎯 Destinatário: ${TARGET_EMAIL}`);
    console.log(`🏪 CNPJ da loja: ${TARGET_CNPJ}\n`);

    const r1 = await sendTest("Confirmação de recebimento", "📨 [TESTE] Solicitação de Ônus Recebida — iWof", buildRecebimentoEmail(solicitacaoSimulada));
    const r2 = await sendTest("Aprovação", "✅ [TESTE] Solicitação de Ônus Aprovada — iWof", buildAprovacaoEmail(solicitacaoSimulada));
    const r3 = await sendTest("Recusa", "❌ [TESTE] Solicitação de Ônus Recusada — iWof", buildRecusaEmail(solicitacaoSimulada));

    console.log("\n─────────────────────────────");
    console.log(`📊 RESULTADO:`);
    console.log(`  Recebimento : ${r1 ? "✅ OK" : "❌ FALHOU"}`);
    console.log(`  Aprovação   : ${r2 ? "✅ OK" : "❌ FALHOU"}`);
    console.log(`  Recusa      : ${r3 ? "✅ OK" : "❌ FALHOU"}`);
    console.log("─────────────────────────────\n");
})();
