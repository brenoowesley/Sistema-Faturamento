import { NextResponse } from 'next/server';
import { google } from 'googleapis';

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({ version: 'v3', auth });

const getRootFolderId = () => {
    return process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || process.env.DRIVE_FOLDER_ID;
};

async function getOrCreateFolder(folderName: string, parentFolderId: string): Promise<string> {
    try {
        const safeFolderName = folderName.replace(/'/g, "\\'");
        const q = `name='${safeFolderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;

        const res = await drive.files.list({
            q,
            fields: 'files(id, name)',
            spaces: 'drive',
            pageSize: 1,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        if (res.data.files && res.data.files.length > 0 && res.data.files[0].id) {
            return res.data.files[0].id; // Retorna pasta existente
        }

        // Cria nova pasta
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
        console.error('Erro ao procurar/criar pasta:', folderName, error);
        throw error;
    }
}

export async function POST(req: Request) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as Blob;
        const clienteNome = formData.get('clienteNome') as string;
        const folderNameCustom = formData.get('folderNameCustom') as string;
        // Identificar loja pode usar clienteNome ou adicionar parametro 'loja' / 'cnpj'

        if (!file || !clienteNome || !folderNameCustom) {
            return NextResponse.json({ error: "Faltam parâmetros obrigatórios." }, { status: 400 });
        }

        const rootFolderId = getRootFolderId();
        if (!rootFolderId) {
            return NextResponse.json({ error: "Root folder ID não configurado." }, { status: 500 });
        }

        // Recupera Ano e Mês atuais para a raiz
        const dataAtual = new Date();
        const anoStr = dataAtual.getFullYear().toString();
        const mesStr = (dataAtual.getMonth() + 1).toString().padStart(2, '0');

        // Cria/Recupera a árvore de pastas
        const anoFolderId = await getOrCreateFolder(anoStr, rootFolderId);
        const mesFolderId = await getOrCreateFolder(mesStr, anoFolderId);
        const lojaFolderId = await getOrCreateFolder(clienteNome, mesFolderId);
        const customFolderId = await getOrCreateFolder(folderNameCustom, lojaFolderId);

        // Upload do arquivo
        const buffer = Buffer.from(await file.arrayBuffer());
        // Tratar nome do arquivo, pega do "pdfBlob" ou gera um nome fixo
        const fileNameOriginal = (file as any).name || `NF_${Date.now()}.pdf`;

        const fileMetadata = {
            name: fileNameOriginal,
            parents: [customFolderId]
        };
        const media = {
            mimeType: 'application/pdf',
            body: require('stream').Readable.from(buffer)
        };

        const res = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, webViewLink',
            supportsAllDrives: true
        });

        return NextResponse.json({ success: true, fileId: res.data.id, link: res.data.webViewLink });
    } catch (e: any) {
        console.error("Erro no upload API triagem:", e);
        return NextResponse.json({ error: e.message || "Erro interno" }, { status: 500 });
    }
}
