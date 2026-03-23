import { NextResponse } from 'next/server';
import { google } from 'googleapis';

// 1. Configuração do Google Drive Auth
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({ version: 'v3', auth });

// ID da Unidade Compartilhada (Shared Drive) — opcional
const SHARED_DRIVE_ID = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID;

// Extração do ID da Pasta Raiz (Oficial iWof)
const getRootFolderId = () => {
    return process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID_PARCIAIS || '1vBylgUjKl1LC8-Ttf8rrL5CdEJYpi9AT';
};

async function findOrCreateFolder(folderName: string, parentFolderId: string): Promise<string> {
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

        return createRes.data.id!;
    } catch (error) {
        console.error('[Drive Error] findOrCreateFolder:', folderName, error);
        throw error;
    }
}

export async function POST(request: Request) {
    try {
        const { fileBase64, fileName, nomeCliente, dataCompetencia } = await request.json();

        if (!fileBase64 || !fileName || !nomeCliente) {
            return NextResponse.json({ success: false, error: "Missing required fields." }, { status: 400 });
        }

        const rootFolderId = getRootFolderId();

        // Hierarquia: [Raiz] -> [Ano/Mês] -> [Cliente]
        // Se dataCompetencia não vier, usa data atual
        const comp = dataCompetencia || new Date().toISOString().slice(0, 7); // YYYY-MM
        const [ano, mes] = comp.split('-');
        const periodLabel = `${ano}/${mes}`;

        const anoFolderId = await findOrCreateFolder(ano, rootFolderId);
        const mesFolderId = await findOrCreateFolder(mes, anoFolderId);
        const clienteFolderId = await findOrCreateFolder(nomeCliente, mesFolderId);

        // Upload do arquivo
        const buffer = Buffer.from(fileBase64, 'base64');
        const fileMetadata = {
            name: fileName,
            parents: [clienteFolderId]
        };
        const media = {
            mimeType: 'application/pdf',
            body: require('stream').Readable.from(buffer)
        };

        const driveRes = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, webViewLink',
            supportsAllDrives: true
        });

        return NextResponse.json({ 
            success: true, 
            id: driveRes.data.id,
            link: driveRes.data.webViewLink 
        });

    } catch (error: any) {
        console.error("Erro no API /api/lancamentos-parciais/upload-nfs:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
