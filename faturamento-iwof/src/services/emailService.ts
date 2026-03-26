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

        console.log(`[DEBUG] findFolder - Iniciando busca EXATA para: "${folderName}" em parent: ${parentFolderId}`);
        console.log(`[DEBUG] findFolder - Query exata: ${qExact}`);

        const resExact = await drive.files.list({
            q: qExact,
            fields: 'files(id, name)',
            spaces: 'drive',
            pageSize: 1,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });

        const exactFiles = resExact.data.files || [];
        console.log(`[DEBUG] findFolder - Resultados da busca exata: ${exactFiles.length}`);

        if (exactFiles.length > 0 && exactFiles[0].id) {
            console.log(`[DEBUG] findFolder - Encontrado (EXATO): ${exactFiles[0].name} (ID: ${exactFiles[0].id})`);
            return exactFiles[0].id;
        }

        // Fuzzy search
        console.log(`[DEBUG] findFolder - Falha na busca exata. Iniciando busca FUZZY em parent: ${parentFolderId}`);
        const resList = await drive.files.list({
            q: `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });

        const totalFolders = resList.data.files || [];
        console.log(`[DEBUG] findFolder - Total de pastas no parent para fuzzy: ${totalFolders.length}`);

        if (totalFolders.length > 0) {
            const requestedNameUpper = folderName.trim().toUpperCase();
            console.log(`[DEBUG] findFolder - Comparando "${requestedNameUpper}" com as pastas encontradas...`);
            
            const foundFolder = totalFolders.find(f => {
                const driveFolderName = f.name || "";
                const pattern = driveFolderName
                    .toUpperCase()
                    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                    .replace(/_/g, "[ &ÇÁÀÂÃÉÊÍÓÔÕÚ']");
                const regex = new RegExp(`^${pattern}$`, 'i');
                const isMatch = regex.test(requestedNameUpper);
                if (isMatch) console.log(`[DEBUG] findFolder - MATCH FUZZY ENCONTRADO: "${driveFolderName}" (ID: ${f.id})`);
                return isMatch;
            });
            
            if (foundFolder && foundFolder.id) return foundFolder.id;
        }

        console.log(`[DEBUG] findFolder - Nenhuma pasta encontrada para "${folderName}"`);
        return null;
    } catch (error) {
        console.error('[DEBUG] [EmailService] Erro fatal em findFolder:', folderName, error);
        return null;
    }
}

async function getFolderPdfs(folderId: string) {
    try {
        console.log(`[DEBUG] getFolderPdfs - Listando PDFs na pasta ID: ${folderId}`);
        const res = await drive.files.list({
            q: `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });
        
        const files = res.data.files || [];
        console.log(`[DEBUG] getFolderPdfs - Encontrados ${files.length} PDFs: ${files.map(f => f.name).join(', ')}`);
        return files;
    } catch (error) {
        console.error('[DEBUG] [EmailService] Erro ao listar PDFs na pasta', folderId, error);
        return [];
    }
}

async function downloadDriveFile(fileId: string): Promise<Buffer> {
    console.log(`[DEBUG] downloadDriveFile - Iniciando download do ID: ${fileId}`);
    const response = await drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' }
    );
    console.log(`[DEBUG] downloadDriveFile - Download concluído para ID: ${fileId} (${(response.data as ArrayBuffer).byteLength} bytes)`);
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
    assunto: string,
    nomePastaManual?: string
) {
    console.log(`\n[DEEP DEBUG] --- Início prepareEmailData ---`);
    console.log(`[DEBUG] Lote ID: ${loteId}`);
    console.log(`[DEBUG] Cliente: ${clienteNome} (ID: ${clienteId})`);
    console.log(`[DEBUG] Razão Social: ${razaoSocial}`);
    console.log(`[DEBUG] Nome Conta Azul: ${nomeContaAzul}`);
    console.log(`[DEBUG] Ciclo Original (Exibição): ${cicloNome}`);
    console.log(`[DEBUG] Nome Pasta Lote (Drive): ${nomePastaManual || 'Não fornecido'}`);

    // 1. Localizar Pasta GCP
    let finalFolderId: string | null = null;
    const rootId = getRootFolderId();
    console.log(`[DEBUG] Root Folder ID Extraído: ${rootId}`);
    
    // Obter Mês/Ano para busca de pastas e para o template
    const now = new Date();
    const uploadAno = now.getFullYear().toString();
    const uploadMes = (now.getMonth() + 1).toString().padStart(2, '0');

    console.log(`[DEBUG] Parâmetros de pesquisa temporal: Ano="${uploadAno}", Mes="${uploadMes}"`);

    if (rootId) {
        const empresaParaPasta = (nomeContaAzul || razaoSocial || clienteNome).trim();
        // PRIORIDADE: nomePastaManual (nome do lote) -> cicloNome (regra) -> "Geral"
        const pastaCiclo = (nomePastaManual || cicloNome || "Geral").trim();
        console.log(`[DEBUG] Termos de busca hierárquica: Empresa="${empresaParaPasta}", Pasta Final="${pastaCiclo}"`);

        console.log(`[DEBUG] 1/4 - Buscando Pasta Ano...`);
        const anoId = await findFolder(uploadAno, rootId);
        if (anoId) {
            console.log(`[DEBUG] Pasta ANO encontrada: ID ${anoId}`);
            console.log(`[DEBUG] 2/4 - Buscando Pasta Mês...`);
            const mesId = await findFolder(uploadMes, anoId);
            if (mesId) {
                console.log(`[DEBUG] Pasta MÊS encontrada: ID ${mesId}`);
                console.log(`[DEBUG] 3/4 - Buscando Pasta Empresa...`);
                const empresaId = await findFolder(empresaParaPasta, mesId);
                if (empresaId) {
                    console.log(`[DEBUG] Pasta EMPRESA encontrada: ID ${empresaId}`);
                    console.log(`[DEBUG] 4/4 - Buscando Pasta Ciclo...`);
                    finalFolderId = await findFolder(pastaCiclo, empresaId);
                } else {
                    console.error(`[DEBUG] falhou ao encontrar pasta EMPRESA: "${empresaParaPasta}"`);
                }
            } else {
                console.error(`[DEBUG] falhou ao encontrar pasta MÊS: "${uploadMes}"`);
            }
        } else {
            console.error(`[DEBUG] falhou ao encontrar pasta ANO: "${uploadAno}"`);
        }
    } else {
        console.error(`[DEBUG] Root ID não configurado ou inválido.`);
    }

    if (finalFolderId) {
        console.log(`[DEBUG] Pasta FINAL (Ciclo) localizada: ID ${finalFolderId}`);
    } else {
        console.error(`[DEBUG] ID FINAL DE PASTA NÃO LOCALIZADO. Nenhum anexo será carregado.`);
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
    console.log(`[DEBUG] Total de anexos carregados: ${attachments.length}`);

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
    if (emailList.length === 0) {
        console.error(`[DEBUG] Lista de destinatários vazia.`);
        throw new Error("Sem destinatários válidos.");
    }

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

    console.log(`[DEBUG] Enviando e-mail para: ${to} (CC: ${cc || 'nenhum'}) com ${attachments.length} anexos.`);

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`[DEBUG] E-mail enviado com sucesso: ${info.messageId}`);
        
        // 5. Registrar no Supabase (Log)
        await supabaseAdmin.from('logs_envio_email').insert({
            lote_id: loteId,
            cliente_nome: razaoSocial || clienteNome,
            destinatarios,
            assunto: mailOptions.subject,
            status: 'Sucesso'
        });

        console.log(`[DEEP DEBUG] --- Fim prepareEmailData (Sucesso) ---\n`);
        return { success: true, destinatarios, anexos_count: attachments.length };
    } catch (error: any) {
        console.error(`[DEBUG] ERRO NO DISPARO REAL:`, error);
        await supabaseAdmin.from('logs_envio_email').insert({
            lote_id: loteId,
            cliente_nome: razaoSocial || clienteNome,
            destinatarios,
            assunto: mailOptions.subject,
            status: 'Erro',
            mensagem_erro: error.message
        });
        console.log(`[DEEP DEBUG] --- Fim prepareEmailData (Falha) ---\n`);
        throw error;
    }
}
