import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { Readable } from 'stream';

/* ================================================================
   /api/lancamentos-parciais/upload-nf-drive
   ================================================================
   Salva um arquivo (PDF ou XML) no Google Drive dentro da mesma
   hierarquia dos lançamentos parciais:
     [Root] → [Ano] → [Mês] → [NomeCliente] → arquivo

   Body (JSON):
     fileBase64    — conteúdo em base64
     fileName      — nome do arquivo (ex: "NF_1234.pdf")
     nomeCliente   — nome da pasta do cliente
     dataCompetencia — "YYYY-MM" (opcional, usa data atual se omitido)
     mimeType      — tipo MIME (default: application/pdf)
   ================================================================ */

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({ version: 'v3', auth });

const getRootFolderId = () =>
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID_PARCIAIS || '1JE_1P8vP3JhtBcildWFEoKay3sMXV7YL';

async function findOrCreateFolder(folderName: string, parentFolderId: string): Promise<string> {
    const safeName = folderName.replace(/'/g, "\\'");
    const q = `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;

    const res = await drive.files.list({
        q,
        fields: 'files(id)',
        spaces: 'drive',
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    });

    if (res.data.files && res.data.files.length > 0 && res.data.files[0].id) {
        return res.data.files[0].id;
    }

    const created = await drive.files.create({
        requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId],
        },
        fields: 'id',
        supportsAllDrives: true,
    });

    return created.data.id!;
}

export async function POST(request: Request) {
    try {
        const { fileBase64, fileName, nomeCliente, dataCompetencia, mimeType } = await request.json();

        if (!fileBase64 || !fileName || !nomeCliente) {
            return NextResponse.json(
                { success: false, error: 'fileBase64, fileName e nomeCliente são obrigatórios.' },
                { status: 400 }
            );
        }

        const rootFolderId = getRootFolderId();
        const comp = dataCompetencia || new Date().toISOString().slice(0, 7); // YYYY-MM
        const [ano, mes] = comp.split('-');

        const anoFolderId = await findOrCreateFolder(ano, rootFolderId);
        const mesFolderId = await findOrCreateFolder(mes, anoFolderId);
        const clienteFolderId = await findOrCreateFolder(nomeCliente, mesFolderId);

        const buffer = Buffer.from(fileBase64, 'base64');
        const fileMimeType = mimeType || 'application/pdf';

        const driveRes = await drive.files.create({
            requestBody: {
                name: fileName,
                parents: [clienteFolderId],
            },
            media: {
                mimeType: fileMimeType,
                body: Readable.from(buffer),
            },
            fields: 'id, webViewLink',
            supportsAllDrives: true,
        });

        return NextResponse.json({
            success: true,
            id: driveRes.data.id,
            link: driveRes.data.webViewLink,
            path: `${ano}/${mes}/${nomeCliente}/${fileName}`,
        });

    } catch (error: any) {
        console.error('[LP] Erro no upload-nf-drive:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
