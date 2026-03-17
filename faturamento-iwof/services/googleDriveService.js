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
        // Camada 1: Busca Exata (Otimizada)
        const safeFolderName = folderName.replace(/'/g, "\\'");
        const qExact = `name='${safeFolderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;
        
        const resExact = await drive.files.list({
            q: qExact,
            fields: 'files(id, name)',
            spaces: 'drive',
            pageSize: 1,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        if (resExact.data.files && resExact.data.files.length > 0) {
            console.log(`[Drive Exact Match] Pasta encontrada: "${folderName}" → ${resExact.data.files[0].id}`);
            return resExact.data.files[0].id;
        }

        // Camada 2: Busca Inteligente (Fuzzy)
        console.log(`[Drive Fuzzy] Busca exata falhou para "${folderName}". Listando diretório pai...`);
        const resList = await drive.files.list({
            q: `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        if (resList.data.files && resList.data.files.length > 0) {
            const requestedNameUpper = folderName.trim().toUpperCase();

            // Lógica de Regex: Se a pasta no Drive tiver _, tratamos como coringa para bater com a pasta solicitada
            const foundFolder = resList.data.files.find(f => {
                const driveFolderName = f.name || "";
                const pattern = driveFolderName
                    .toUpperCase()
                    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex
                    .replace(/_/g, "[ &ÇÁÀÂÃÉÊÍÓÔÕÚ']"); // _ vira coringa
                const regex = new RegExp(`^${pattern}$`, 'i');
                return regex.test(requestedNameUpper);
            });

            if (foundFolder && foundFolder.id) {
                console.log(`[Drive Fuzzy Match] Pasta correspondente encontrada: "${foundFolder.name}" para o pedido "${folderName}" → ${foundFolder.id}`);
                return foundFolder.id;
            }
        }

        // Camada 3: Criação
        const fileMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId]
        };
        const createRes = await drive.files.create({
            requestBody: fileMetadata,
            fields: 'id',
            supportsAllDrives: true
        });
        const newId = createRes.data.id;
        console.log(`[Drive Create] Pasta criada: "${folderName}" → ${newId}`);
        return newId;
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
