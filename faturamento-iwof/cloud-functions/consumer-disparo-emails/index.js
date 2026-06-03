/**
 * Cloud Run Service: consumer-disparo-emails
 * ============================================
 * Triggered by Pub/Sub push subscription → Cloud Run HTTP endpoint
 * 
 * ANTI-LOOP DESIGN:
 * 1. SEMPRE retorna 2xx (nunca faz o Pub/Sub re-entregar)
 * 2. Checa idempotência via logs_envio_email ANTES de processar
 * 3. Checa se o lote foi CANCELADO antes de enviar
 * 4. Erros internos são capturados e gravados no Supabase como log de "Erro"
 * 5. A mensagem é sempre considerada "processada" pelo Pub/Sub
 * 
 * Deploy (Cloud Run):
 *   gcloud run deploy consumer-disparo-emails \
 *     --source=./cloud-functions/consumer-disparo-emails \
 *     --region=us-central1 \
 *     --memory=512Mi \
 *     --timeout=120s \
 *     --max-instances=5 \
 *     --set-env-vars="SUPABASE_URL=...,SUPABASE_SERVICE_KEY=...,GOOGLE_CLIENT_EMAIL=...,GOOGLE_PRIVATE_KEY=...,SMTP_HOST=...,SMTP_PORT=...,SMTP_USER=...,SMTP_PASS=...,GOOGLE_DRIVE_ROOT_FOLDER_ID=..."
 */

const express = require('express');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

// ═══════════════════════════════════════
// EXPRESS SERVER
// ═══════════════════════════════════════

const app = express();
app.use(express.json());

// ═══════════════════════════════════════
// CONFIGURAÇÃO
// ═══════════════════════════════════════

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });

const mailTransporter = nodemailer.createTransport({
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
    rateDelta: 1000,
    rateLimit: 2,
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const getRootFolderId = () => {
    const raw = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '';
    const sanitized = raw.trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
    return sanitized.includes('drive.google.com')
        ? sanitized.split('/').pop()?.split('?')[0]
        : sanitized;
};

// ═══════════════════════════════════════
// HELPERS: Google Drive
// ═══════════════════════════════════════

async function findFolder(folderName, parentFolderId) {
    try {
        const safeName = folderName.replace(/'/g, "\\'");
        const q = `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;

        const res = await drive.files.list({
            q,
            fields: 'files(id, name)',
            spaces: 'drive',
            pageSize: 1,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });

        if (res.data.files?.length > 0) return res.data.files[0].id;

        // Fuzzy fallback
        const resList = await drive.files.list({
            q: `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });

        const nameUpper = folderName.trim().toUpperCase();
        const match = (resList.data.files || []).find(f => {
            const pattern = (f.name || '')
                .toUpperCase()
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/_/g, "[ &ÇÁÀÂÃÉÊÍÓÔÕÚ']");
            return new RegExp(`^${pattern}$`, 'i').test(nameUpper);
        });

        return match?.id || null;
    } catch (err) {
        console.error(`[findFolder] Erro para "${folderName}":`, err.message);
        return null;
    }
}

async function getFolderPdfs(folderId) {
    try {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });
        return res.data.files || [];
    } catch (err) {
        console.error(`[getFolderPdfs] Erro:`, err.message);
        return [];
    }
}

async function downloadFile(fileId) {
    const response = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' }
    );
    return Buffer.from(response.data);
}

// ═══════════════════════════════════════
// F-10: Fechamento automático do lote
// Chamada após cada log final (Sucesso ou Erro).
// A função SQL é atômica: só fecha o lote se TODOS
// os consolidados já têm log final, evitando race
// conditions entre múltiplos workers do Cloud Run.
// ═══════════════════════════════════════
async function verificarEConcluirLote(loteId) {
    if (!loteId) return;
    try {
        const { error } = await supabaseAdmin.rpc('verificar_e_concluir_lote', {
            p_lote_id: loteId
        });
        if (error) {
            console.error(`[CONSUMER] ⚠️ Erro ao verificar conclusão do lote ${loteId.slice(0,8)}:`, error.message);
        } else {
            console.log(`[CONSUMER] 🔄 verificar_e_concluir_lote executado para lote ${loteId.slice(0,8)}`);
        }
    } catch (err) {
        // Não propagar: falha nesta função auxiliar não deve quebrar o fluxo principal
        console.error(`[CONSUMER] ⚠️ Exceção em verificarEConcluirLote:`, err.message);
    }
}

// ═══════════════════════════════════════
// TEMPLATE HTML (inline para independência)
// ═══════════════════════════════════════

function getEmailTemplate(clienteNome, cicloNome, mes, ano) {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #1e3a5f, #2d5986); padding: 30px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px;">📄 Faturamento iWof</h1>
      <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">${mes}/${ano}</p>
    </div>
    <div style="padding: 30px;">
      <p style="font-size: 16px; color: #333;">Olá, <strong>${clienteNome}</strong>!</p>
      <p style="font-size: 14px; color: #555; line-height: 1.6;">
        Segue em anexo a documentação referente ao faturamento do período <strong>${mes}/${ano}</strong>
        ${cicloNome !== 'Geral' ? ` — Ciclo: <strong>${cicloNome}</strong>` : ''}.
      </p>
      <p style="font-size: 14px; color: #555;">Em caso de dúvidas, entre em contato pelo WhatsApp:</p>
      <div style="text-align: center; margin: 20px 0;">
        <a href="https://wa.me/5527999999999" style="display: inline-block; background: #25D366; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">💬 WhatsApp Financeiro</a>
      </div>
    </div>
    <div style="background: #f8f9fa; padding: 15px; text-align: center; font-size: 11px; color: #999;">
      iWof Tecnologia — Este é um e-mail automático.
    </div>
  </div>
</body>
</html>`;
}

// ═══════════════════════════════════════
// ENTRY POINT: Pub/Sub Push → HTTP POST
// ═══════════════════════════════════════

/**
 * Cloud Run recebe POST do Pub/Sub push subscription.
 * O body contém: { message: { data: "base64...", messageId: "..." }, subscription: "..." }
 * 
 * ⚠️  REGRA DE OURO: NUNCA retornar 4xx/5xx por erro de negócio.
 *     Se a função "falha" (non-2xx), o Pub/Sub re-entrega a mensagem → LOOP.
 *     Qualquer erro DEVE ser capturado, logado no Supabase, e respondemos 204.
 */
app.post('/', async (req, res) => {
    let payload;

    try {
        // 1. Decodificar mensagem do Pub/Sub push
        const rawData = req.body?.message?.data;
        if (!rawData) {
            console.error('[CONSUMER] Mensagem sem data. Ignorando.', JSON.stringify(req.body || {}).substring(0, 500));
            return res.status(204).send();
        }

        payload = JSON.parse(Buffer.from(rawData, 'base64').toString('utf-8'));
        const { loteId, clienteId, clienteNome, razaoSocial, nomeContaAzul, cicloNome, destinatarios, assunto, nomePastaLote, mes, ano } = payload;

        console.log(`[CONSUMER] Processando: ${razaoSocial || clienteNome} (ID: ${clienteId})`);

        // ═══════════════════════════════════════
        // 1.5. CANCELAMENTO: Checar se o lote foi parado
        // ═══════════════════════════════════════
        if (loteId) {
            const { data: loteCheck } = await supabaseAdmin
                .from('faturamentos_lote')
                .select('status')
                .eq('id', loteId)
                .single();

            if (loteCheck?.status === 'CANCELADO') {
                console.log(`[CONSUMER] ⛔ Lote ${loteId.slice(0, 8)} CANCELADO. Ignorando envio para ${razaoSocial || clienteNome}.`);
                return res.status(204).send();
            }
        }

        // ═══════════════════════════════════════
        // 2. IDEMPOTÊNCIA: Checar se já processou
        // ═══════════════════════════════════════
        const { data: existingLog } = await supabaseAdmin
            .from('logs_envio_email')
            .select('id, status')
            .eq('lote_id', loteId)
            .eq('cliente_id', clienteId)
            .limit(1)
            .single();

        if (existingLog) {
            console.log(`[CONSUMER] ⏭️ Já processado (status: ${existingLog.status}). Pulando.`);
            return res.status(204).send();
        }

        // ⚠️ INSERE "PROCESSANDO" PARA BLOQUEAR RACE CONDITIONS (Disparos múltiplos)
        // Se duas requisições entrarem ao mesmo tempo, a primeira cria isso e a segunda vai cair na checagem acima 
        // ou falhar na restrição do banco. De qualquer forma, garante que o worker assumiu o envio.
        const { data: processandoLog } = await supabaseAdmin.from('logs_envio_email').insert({
            lote_id: loteId,
            cliente_id: clienteId,
            cliente_nome: razaoSocial || clienteNome,
            destinatarios,
            assunto: assunto || `Faturamento Mensal - ${razaoSocial}`,
            status: 'Processando',
        }).select('id').single();

        const logId = processandoLog?.id;

        // ═══════════════════════════════════════
        // 3. Localizar pasta no Drive e baixar PDFs
        // ═══════════════════════════════════════
        const attachments = [];
        const rootId = getRootFolderId();

        if (rootId) {
            const empresaNome = (nomeContaAzul || razaoSocial || clienteNome).trim();
            const pastaCiclo = (nomePastaLote || cicloNome || 'Geral').trim();

            const anoId = await findFolder(ano || new Date().getFullYear().toString(), rootId);
            if (anoId) {
                const mesId = await findFolder(mes || (new Date().getMonth() + 1).toString().padStart(2, '0'), anoId);
                if (mesId) {
                    const empresaId = await findFolder(empresaNome, mesId);
                    if (empresaId) {
                        const cicloId = await findFolder(pastaCiclo, empresaId);
                        if (cicloId) {
                            const pdfs = await getFolderPdfs(cicloId);
                            for (const pdf of pdfs) {
                                if (pdf.id && pdf.name) {
                                    const buffer = await downloadFile(pdf.id);
                                    attachments.push({ filename: pdf.name, content: buffer });
                                }
                            }
                        }
                    }
                }
            }
        }

        console.log(`[CONSUMER] ${attachments.length} anexo(s) carregado(s).`);

        // ═══════════════════════════════════════
        // 4. Montar e enviar e-mail
        // ═══════════════════════════════════════
        const emailList = destinatarios.split(/[,;]+/).map(e => e.trim()).filter(e => e.length > 0);
        if (emailList.length === 0) {
            throw new Error('Sem destinatários válidos após parse.');
        }

        const to = emailList[0];
        const cc = emailList.slice(1).join(', ');
        const nomeDaLoja = nomeContaAzul || razaoSocial || clienteNome;

        const htmlBody = getEmailTemplate(nomeDaLoja, cicloNome, mes, ano);

        const mailOptions = {
            from: `"Financeiro iWof" <${process.env.SMTP_USER}>`,
            to,
            cc: cc.length > 0 ? cc : undefined,
            subject: assunto || `Faturamento Mensal - ${razaoSocial}`,
            html: htmlBody,
            attachments,
        };

        console.log(`[CONSUMER] 📨 Enviando para: ${to} (CC: ${cc || 'nenhum'}) | ${attachments.length} anexos`);

        const info = await mailTransporter.sendMail(mailOptions);
        console.log(`[CONSUMER] ✅ Enviado! MessageId: ${info.messageId}`);

        // ═══════════════════════════════════════
        // 5. Registrar SUCESSO no Supabase
        // ═══════════════════════════════════════
        if (logId) {
            await supabaseAdmin.from('logs_envio_email').update({
                status: 'Sucesso',
                assunto: mailOptions.subject
            }).eq('id', logId);
        } else {
            await supabaseAdmin.from('logs_envio_email').insert({
                lote_id: loteId,
                cliente_id: clienteId,
                cliente_nome: razaoSocial || clienteNome,
                destinatarios,
                assunto: mailOptions.subject,
                status: 'Sucesso',
            });
        }

        // F-10: verificar se todos os clientes do lote foram processados e fechar o lote
        await verificarEConcluirLote(loteId);

        return res.status(204).send();

    } catch (error) {
        // ═══════════════════════════════════════
        // ⚠️  CAPTURA TOTAL DE ERROS
        //     NUNCA retornar non-2xx — isso causa re-entrega no Pub/Sub (LOOP)
        // ═══════════════════════════════════════
        console.error(`[CONSUMER] ❌ ERRO:`, error.message || error);

        try {
            if (payload?.loteId) {
                // Remove o log temporário de "Processando" para substituí-lo pelo erro final
                await supabaseAdmin.from('logs_envio_email')
                    .delete()
                    .eq('lote_id', payload.loteId)
                    .eq('cliente_id', payload.clienteId)
                    .eq('status', 'Processando');

                await supabaseAdmin.from('logs_envio_email').insert({
                    lote_id: payload.loteId,
                    cliente_id: payload.clienteId || null,
                    cliente_nome: payload.razaoSocial || payload.clienteNome || '—',
                    destinatarios: payload.destinatarios || '',
                    assunto: payload.assunto || '',
                    status: 'Erro',
                    mensagem_erro: (error.message || 'Erro desconhecido').substring(0, 500),
                });
                console.log(`[CONSUMER] Log de erro gravado no Supabase.`);

                // F-10: mesmo em caso de erro, verificar se o lote pode ser fechado
                await verificarEConcluirLote(payload.loteId);
            }
        } catch (logError) {
            // Se nem o log conseguir gravar, apenas loga no console
            console.error(`[CONSUMER] Falha ao gravar log de erro:`, logError.message);
        }

        // ⚠️  RETORNA 204 — o Pub/Sub dá ACK e NÃO reenvia
        return res.status(204).send();
    }
});

// Health check endpoint
app.get('/', (req, res) => {
    res.status(200).send('OK');
});

// ═══════════════════════════════════════
// EXPORT & START SERVER
// ═══════════════════════════════════════
// Para Cloud Functions Gen2 (que espera a função processarEmail)
exports.processarEmail = app;

// Para rodar localmente ou via docker direto (Cloud Run custom)
if (require.main === module) {
    const PORT = process.env.PORT || 8080;
    app.listen(PORT, () => {
        console.log(`[CONSUMER] 🚀 Servidor Express rodando na porta ${PORT}`);
    });
}
