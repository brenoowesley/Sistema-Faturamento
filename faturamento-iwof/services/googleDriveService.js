const { google } = require('googleapis');
require('dotenv').config();

// Assuma que temos as configs da Service Account no .env (ou JSON carregado)
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({ version: 'v3', auth });

// 1. Extração Inteligente do ID da Pasta (Sincronizado com API)
const getRootFolderId = () => {
    // Ordem de Prioridade: GOOGLE_DRIVE_ROOT_FOLDER_ID > DRIVE_FOLDER_URL
    const rawFolderEnv = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || process.env.DRIVE_FOLDER_URL || '1vBylgUjKl1LC8-Ttf8rrL5CdEJYpi9AT';

    // Sanitização: .trim() + remoção de caracteres invisíveis
    const sanitizedInput = rawFolderEnv.trim().replace(/[\u200B-\u200D\uFEFF]/g, "");

    // Extração robusta: Se for URL, pega o ID após a última barra
    const extractedId = sanitizedInput.includes('drive.google.com')
        ? sanitizedInput.split('/').pop()?.split('?')[0]
        : sanitizedInput;

    return extractedId;
};

const ROOT_FOLDER_ID = getRootFolderId();

async function findOrCreateFolder(folderName, parentFolderId) {
    try {
        const q = `name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;
        const res = await drive.files.list({
            q,
            fields: 'files(id, name)',
            spaces: 'drive',
            pageSize: 1,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            driveId: ROOT_FOLDER_ID,
            corpora: 'drive'
        });

        if (res.data.files && res.data.files.length > 0) {
            return res.data.files[0].id;
        } else {
            // Create
            const fileMetadata = {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentFolderId]
            };
            const createRes = await drive.files.create({
                requestBody: fileMetadata, // 'resource' renomeado para 'requestBody' na v3 googleapis
                fields: 'id',
                supportsAllDrives: true
            });
            return createRes.data.id;
        }
    } catch (error) {
        console.error('Erro ao procurar/criar pasta:', folderName, error);
        throw error;
    }
}

async function uploadDocumento(buffer, fileName, clienteNome, ciclo) {
    try {
        const currentYear = new Date().getFullYear().toString();
        // Mês atual ex: '02'
        const currentMonth = (new Date().getMonth() + 1).toString().padStart(2, '0');

        console.log(`Iniciando upload para: ${currentYear} > ${currentMonth} > ${clienteNome} > ${ciclo}`);

        // Árvore de Pastas (Descomentar para usar quando houver Service Account real)
        /*
        const anoFolderId = await findOrCreateFolder(currentYear, ROOT_FOLDER_ID);
        const mesFolderId = await findOrCreateFolder(currentMonth, anoFolderId);
        const clienteFolderId = await findOrCreateFolder(clienteNome, mesFolderId);
        const cicloFolderId = await findOrCreateFolder(ciclo, clienteFolderId);
        */
        const cicloFolderId = 'dummy_ciclo_folder_id'; // MOCK para evitar quebra caso .env esteja vazio

        const fileMetadata = {
            name: fileName,
            parents: [cicloFolderId]
        };

        const media = {
            mimeType: 'application/pdf',
            body: require('stream').Readable.from(buffer)
        };

        /*
        const file = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id'
        });
        console.log('File Id:', file.data.id);
        */

        console.log(`Documento ${fileName} pronto (Simulado) em ciclo ${ciclo}`);

        return true;
    } catch (error) {
        console.error('Erro no uploadDrive:', error);
        throw error;
    }
}

module.exports = {
    uploadDocumento
};
