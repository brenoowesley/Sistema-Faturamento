import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// 1. Configuração do Google Drive Auth
const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
});

const drive = google.drive({ version: 'v3', auth });

// Extrai o ID da pasta quer venha da variável nova ou da URL antiga
const extractFolderId = () => {
    if (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) return process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    if (process.env.DRIVE_FOLDER_URL) {
        const parts = process.env.DRIVE_FOLDER_URL.split('/');
        return parts[parts.length - 1] || parts[parts.length - 2];
    }
    return null;
};
const ROOT_FOLDER_ID = extractFolderId();

// 2. Configuração do Supabase Admin (Ignora RLS)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function findOrCreateFolder(folderName: string, parentFolderId: string) {
    try {
        const q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;
        const res = await drive.files.list({ q, fields: 'files(id, name)', spaces: 'drive', pageSize: 1 });

        if (res.data.files && res.data.files.length > 0 && res.data.files[0].id) {
            return res.data.files[0].id;
        } else {
            const fileMetadata = { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentFolderId] };
            const createRes = await drive.files.create({ requestBody: fileMetadata, fields: 'id' });
            return createRes.data.id;
        }
    } catch (error) {
        console.error('Erro ao procurar/criar pasta:', folderName, error);
        throw error;
    }
}

export async function POST(request: Request) {
    try {
        if (!ROOT_FOLDER_ID) throw new Error("A variável do Google Drive (URL ou ID) não está configurada no servidor.");

        const formData = await request.formData();
        const loteId = formData.get('loteId') as string;
        // Captura os arquivos independentemente de como o frontend os nomeou no FormData
        const files = [
            ...formData.getAll('files'),
            ...formData.getAll('file'),
            ...formData.getAll('files[]'),
            ...formData.getAll('boletos'),
            ...formData.getAll('nfse')
        ] as File[];

        if (!loteId) throw new Error("ID do Lote não fornecido na requisição.");
        if (!files || files.length === 0) throw new Error("Nenhum arquivo recebido para upload.");

        console.log(`[Next.js API] Iniciando upload de ${files.length} arquivos para o lote: ${loteId}`);

        // 3. Busca o nome oficial da pasta do Lote no Supabase
        const { data: lote, error: loteErr } = await supabaseAdmin
            .from('faturamentos_lote')
            .select('nome_pasta, data_competencia')
            .eq('id', loteId)
            .single();

        if (loteErr || !lote) throw new Error("Lote não encontrado no banco de dados.");

        const folderName = lote.nome_pasta || `Lote ${lote.data_competencia}`;

        // 4. Encontra ou Cria a pasta no Google Drive
        const loteFolderId = await findOrCreateFolder(folderName, ROOT_FOLDER_ID);

        if (!loteFolderId) throw new Error("Falha ao obter o Folder ID do Google Drive");

        // Salva a tag no banco pra próxima
        await supabaseAdmin.from('faturamentos_lote').update({ drive_folder_id: loteFolderId }).eq('id', loteId);

        // 5. Envia os binários transformando as instâncias nativas `File` da Edge pra Buffers e depois Readable Streams
        const { Readable } = require('stream');

        const uploadPromises = files.map(async (file) => {
            const buffer = Buffer.from(await file.arrayBuffer());

            const fileMetadata = {
                name: file.name,
                parents: [loteFolderId as string]
            };

            const media = {
                mimeType: file.type || 'application/pdf',
                body: Readable.from(buffer)
            };

            return drive.files.create({
                requestBody: fileMetadata,
                media: media,
                fields: 'id'
            });
        });

        await Promise.all(uploadPromises);

        console.log(`[Next.js Drive] 🚀 Upload de ${files.length} PDFs Concluído na pasta ${folderName}`);

        return NextResponse.json({ success: true, message: `Upload realizado para ${files.length} arquivos` });

    } catch (error: any) {
        console.error("Erro no API /drive/upload:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
