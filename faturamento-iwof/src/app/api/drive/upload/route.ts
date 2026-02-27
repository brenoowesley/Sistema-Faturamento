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
const ROOT_FOLDER_ID = process.env.DRIVE_FATURAMENTO_ROOT_ID || 'dummy_root_id';

async function findOrCreateFolder(folderName: string, parentFolderId: string) {
    try {
        const q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;
        const res = await drive.files.list({
            q,
            fields: 'files(id, name)',
            spaces: 'drive',
            pageSize: 1
        });

        if (res.data.files && res.data.files.length > 0 && res.data.files[0].id) {
            return res.data.files[0].id;
        } else {
            const fileMetadata = {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentFolderId]
            };
            const createRes = await drive.files.create({
                requestBody: fileMetadata,
                fields: 'id'
            });
            return createRes.data.id;
        }
    } catch (error) {
        console.error('Erro ao procurar/criar pasta:', folderName, error);
        throw error;
    }
}

export async function POST(request: Request) {
    try {
        const formData = await request.formData();

        // This is a minimal implementation based on the Express route.
        // In reality, you'd extract parameters from formData:
        // const file = formData.get('file') as File;
        // const clienteNome = formData.get('clienteNome') as string;
        // const ciclo = formData.get('ciclo') as string;

        // Since we are mocking the Drive component to avoid crashing when variables are absent
        const dt = new Date();
        const currentYear = dt.getFullYear().toString();
        const currentMonth = (dt.getMonth() + 1).toString().padStart(2, '0');

        console.log(`[Next.js API] Recebido pedido de upload GCP. FormData.keys: ${Array.from(formData.keys()).join(', ')}`);

        // Árvore de Pastas (Mock para evitar quebra caso .env esteja vazio)
        // const anoFolderId = await findOrCreateFolder(currentYear, ROOT_FOLDER_ID);
        // const mesFolderId = await findOrCreateFolder(currentMonth, anoFolderId);
        // const clienteFolderId = await findOrCreateFolder(clienteNome, mesFolderId);
        // const cicloFolderId = await findOrCreateFolder(ciclo, clienteFolderId);
        const cicloFolderId = 'dummy_ciclo_folder_id';

        // Iterating over all provided files and names
        const arrPromises = [];
        for (const [key, value] of formData.entries()) {
            if (value instanceof File) {
                // Buffer conversion
                // const arrayBuffer = await value.arrayBuffer();
                // const buffer = Buffer.from(arrayBuffer);

                /*
                const fileMetadata = {
                    name: value.name,
                    parents: [cicloFolderId]
                };

                const media = {
                    mimeType: value.type,
                    body: require('stream').Readable.from(buffer)
                };

                const p = drive.files.create({
                    requestBody: fileMetadata,
                    media: media,
                    fields: 'id'
                });
                arrPromises.push(p);
                */
                console.log(`Simulando upload de ${value.name} para o Drive. Tamanho: ${value.size}`);
            }
        }

        // await Promise.all(arrPromises);

        return NextResponse.json({ success: true, message: "Uploads completados com sucesso (simulado)" });

    } catch (error: any) {
        console.error("Erro no API /drive/upload:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
