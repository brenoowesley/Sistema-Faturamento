import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient } from "@supabase/supabase-js";

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
            return res.data.files[0].id as string;
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
            return createRes.data.id as string;
        }
    } catch (error) {
        console.error('Erro ao procurar/criar pasta:', folderName, error);
        throw error;
    }
}

export async function POST(request: Request) {
    try {
        const formData = await request.formData();

        const loteId = formData.get('loteId') as string;
        const targetFolderName = formData.get('targetFolderName') as string || `Lote ${new Date().toISOString().split('T')[0]}`;

        console.log(`[Next.js API] Recebido pedido de upload GCP. FormData.keys: ${Array.from(formData.keys()).join(', ')}`);

        let rootFolderId: string | null | undefined = 'dummy_ciclo_folder_id';

        if (loteId) {
            const supabase = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
            );

            const { data: lote } = await supabase.from('faturamentos_lote').select('*').eq('id', loteId).single();

            if (lote) {
                rootFolderId = lote.drive_folder_id;

                if (!rootFolderId && ROOT_FOLDER_ID !== 'dummy_root_id') {
                    rootFolderId = await findOrCreateFolder(lote.nome_pasta || targetFolderName, ROOT_FOLDER_ID);
                    // Salva o ID no Supabase para as próximas requisições
                    await supabase.from('faturamentos_lote').update({ drive_folder_id: rootFolderId }).eq('id', loteId);
                }
            }
        } else if (ROOT_FOLDER_ID !== 'dummy_root_id') {
            rootFolderId = await findOrCreateFolder(targetFolderName, ROOT_FOLDER_ID);
        }

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
                    parents: [rootFolderId as string]
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
