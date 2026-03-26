import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { getBillingTemplate } from './email/templates/billingTemplate';

// Setup Drive API
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const getRootFolderId = () => {
    const rawFolderEnv = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || process.env.DRIVE_FOLDER_URL;
    if (!rawFolderEnv) return null;
    const sanitizedInput = rawFolderEnv.trim().replace(/[\u200B-\u200D\uFEFF]/g, "");
    return sanitizedInput.includes('drive.google.com')
        ? sanitizedInput.split('/').pop()?.split('?')[0]
        : sanitizedInput;
};

// Helper para encontrar pasta (semelhante ao upload, mas focado apenas em achar)
async function findFolder(folderName: string, parentFolderId: string): Promise<string | null> {
    try {
        const safeFolderName = folderName.replace(/'/g, "\\'");
        const qExact = `name='${safeFolderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;

        const resExact = await drive.files.list({
            q: qExact,
            fields: 'files(id, name)',
            spaces: 'drive',
            pageSize: 1,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });

        if (resExact.data.files && resExact.data.files.length > 0 && resExact.data.files[0].id) {
            return resExact.data.files[0].id;
        }

        // Fuzzy search
        const resList = await drive.files.list({
            q: `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });

        if (resList.data.files && resList.data.files.length > 0) {
            const requestedNameUpper = folderName.trim().toUpperCase();
            const foundFolder = resList.data.files.find(f => {
                const driveFolderName = f.name || "";
                const pattern = driveFolderName
                    .toUpperCase()
                    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                    .replace(/_/g, "[ &ÇÁÀÂÃÉÊÍÓÔÕÚ']");
                const regex = new RegExp(`^${pattern}$`, 'i');
                return regex.test(requestedNameUpper);
            });
            if (foundFolder && foundFolder.id) return foundFolder.id;
        }

        return null;
    } catch (error) {
        console.error('[EmailService] Erro ao buscar pasta:', folderName, error);
        return null;
    }
}

async function getFolderPdfs(folderId: string) {
    try {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });
        return res.data.files || [];
    } catch (error) {
        console.error('[EmailService] Erro ao listar PDFs na pasta', folderId, error);
        return [];
    }
}

async function downloadDriveFile(fileId: string): Promise<Buffer> {
    const response = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' }
    );
    return Buffer.from(response.data as ArrayBuffer);
}

export async function prepareEmailData(
    loteId: string,
    clienteId: string,
    clienteNome: string,
    razaoSocial: string,
    nomeContaAzul: string,
    cicloNome: string,
    destinatarios: string,
    assunto: string
) {
    // 1. Localizar Pasta GCP
    let finalFolderId: string | null = null;
    const rootId = getRootFolderId();
    
    // Obter Mês/Ano para busca de pastas e para o template
    const now = new Date();
    const uploadAno = now.getFullYear().toString();
    const uploadMes = (now.getMonth() + 1).toString().padStart(2, '0');

    if (rootId) {
        const empresaParaPasta = (nomeContaAzul || razaoSocial || clienteNome).trim();
        const pastaCiclo = (cicloNome || "Geral").trim();

        const anoId = await findFolder(uploadAno, rootId);
        if (anoId) {
            const mesId = await findFolder(uploadMes, anoId);
            if (mesId) {
                const empresaId = await findFolder(empresaParaPasta, mesId);
                if (empresaId) {
                    finalFolderId = await findFolder(pastaCiclo, empresaId);
                }
            }
        }
    }

    // 2. Baixar Anexos
    const attachments: any[] = [];
    if (finalFolderId) {
        const pdfs = await getFolderPdfs(finalFolderId);
        for (const pdf of pdfs) {
            if (pdf.id && pdf.name) {
                const buffer = await downloadDriveFile(pdf.id);
                attachments.push({
                    filename: pdf.name,
                    content: buffer
                });
            }
        }
    }

    // 3. Montar HTML Rico
    const htmlBody = getBillingTemplate({
        clienteNome,
        cicloNome,
        mes: uploadMes,
        ano: uploadAno
    });

    // 4. Disparar via Nodemailer
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '465'),
        secure: process.env.SMTP_PORT === '465',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        }
    });

    const emailList = destinatarios.split(/[,;]+/).map((e: string) => e.trim()).filter((e: string) => e.length > 0);
    if (emailList.length === 0) throw new Error("Sem destinatários válidos.");

    const to = emailList[0];
    const cc = emailList.slice(1).join(', ');

    const mailOptions = {
        from: `"Financeiro iWof" <${process.env.SMTP_USER}>`,
        to,
        cc: cc.length > 0 ? cc : undefined,
        subject: assunto || `Faturamento Mensal - ${razaoSocial}`,
        html: htmlBody,
        attachments
    };

    try {
        await transporter.sendMail(mailOptions);
        
        // 5. Registrar no Supabase (Log)
        await supabaseAdmin.from('logs_envio_email').insert({
            lote_id: loteId,
            cliente_nome: razaoSocial || clienteNome,
            destinatarios,
            assunto: mailOptions.subject,
            status: 'Sucesso'
        });

        return { success: true, destinatarios, anexos_count: attachments.length };
    } catch (error: any) {
        console.error(`[EmailService] Erro disparo para ${clienteNome}:`, error);
        await supabaseAdmin.from('logs_envio_email').insert({
            lote_id: loteId,
            cliente_nome: razaoSocial || clienteNome,
            destinatarios,
            assunto: mailOptions.subject,
            status: 'Erro',
            mensagem_erro: error.message
        });
        throw error;
    }
}
