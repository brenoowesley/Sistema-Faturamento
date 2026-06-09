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

// Raiz dos Lançamentos Parciais (ID correto: 1JE_...)
const getRootFolderId = () => {
    const id = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID_PARCIAIS || '1JE_1P8vP3JhtBcildWFEoKay3sMXV7YL';
    console.log(`[LP upload-nfs] Root folder ID: ${id} (env: ${process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID_PARCIAIS ? 'SET' : 'FALLBACK'})`);
    return id;
};

async function findOrCreateFolder(folderName: string, parentFolderId: string): Promise<string> {
    try {
        const safeFolderName = (folderName || 'Indefinido').replace(/'/g, "\\'");
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
            console.log(`[LP upload-nfs] Pasta encontrada: "${folderName}" → ${resExact.data.files[0].id}`);
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

        console.log(`[LP upload-nfs] Pasta criada: "${folderName}" → ${createRes.data.id}`);
        return createRes.data.id!;
    } catch (error) {
        console.error(`[LP upload-nfs] Erro findOrCreateFolder("${folderName}", "${parentFolderId}"):`, error);
        throw error;
    }
}

export async function POST(request: Request) {
    try {
        const { fileBase64, fileName, nomeCliente, dataCompetencia, nomePasta } = await request.json();

        console.log(`[LP upload-nfs] Recebido: fileName=${fileName}, nomeCliente=${nomeCliente}, nomePasta=${nomePasta}, dataCompetencia=${dataCompetencia}`);

        if (!fileBase64 || !fileName || !nomeCliente) {
            return NextResponse.json({ success: false, error: "Missing required fields." }, { status: 400 });
        }

        const rootFolderId = getRootFolderId();

        // Hierarquia idêntica ao faturamento principal:
        // Root / Ano / Mês / Empresa / nome_pasta_ciclo / arquivo
        const comp = dataCompetencia || new Date().toISOString().slice(0, 7); // YYYY-MM
        const [ano, mes] = comp.split('-');
        const pastaFinal = nomePasta || 'Lancamentos_Parciais';

        console.log(`[LP upload-nfs] Caminho: ${ano}/${mes}/${nomeCliente}/${pastaFinal}/${fileName}`);

        const anoFolderId = await findOrCreateFolder(ano, rootFolderId);
        const mesFolderId = await findOrCreateFolder(mes, anoFolderId);
        const clienteFolderId = await findOrCreateFolder(nomeCliente, mesFolderId);
        const cicloFolderId = await findOrCreateFolder(pastaFinal, clienteFolderId);

        // Upload do arquivo
        const buffer = Buffer.from(fileBase64, 'base64');
        const fileMetadata = {
            name: fileName,
            parents: [cicloFolderId]
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

        const path = `${ano}/${mes}/${nomeCliente}/${pastaFinal}/${fileName}`;
        console.log(`[LP upload-nfs] ✅ Upload concluído: ${path} → driveId=${driveRes.data.id}`);

        return NextResponse.json({ 
            success: true, 
            id: driveRes.data.id,
            link: driveRes.data.webViewLink,
            path
        });

    } catch (error: any) {
        console.error("[LP upload-nfs] ❌ Erro:", error?.message || error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
