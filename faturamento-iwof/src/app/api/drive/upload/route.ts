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

// 1. Extração Inteligente do ID da Pasta (Movida para dentro do POST para maior flexibilidade)
const getRootFolderId = () => {
    const rawFolderEnv = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || process.env.DRIVE_FOLDER_ID || process.env.DRIVE_FOLDER_URL;

    if (!rawFolderEnv) return null;

    // Se for um URL, extrai apenas o ID final
    return rawFolderEnv.includes('drive.google.com')
        ? rawFolderEnv.split('/').pop()?.split('?')[0]
        : rawFolderEnv;
};

// 2. Configuração do Supabase Admin (Ignora RLS)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function findOrCreateFolder(folderName: string, parentFolderId: string) {
    try {
        const q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;
        const res = await drive.files.list({
            q,
            fields: 'files(id, name)',
            spaces: 'drive',
            pageSize: 1,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        if (res.data.files && res.data.files.length > 0 && res.data.files[0].id) {
            return res.data.files[0].id;
        } else {
            const fileMetadata = { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentFolderId] };
            const createRes = await drive.files.create({
                requestBody: fileMetadata,
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

export async function POST(request: Request) {
    try {
        const rootFolderId = getRootFolderId();

        if (!rootFolderId) {
            console.error("ERRO: Variáveis DRIVE_FOLDER_ID ou DRIVE_FOLDER_URL ausentes.");
            return NextResponse.json(
                { success: false, error: "A variável do Google Drive (URL ou ID) não está configurada no servidor." },
                { status: 500 }
            );
        }

        const formData = await request.formData();
        const loteId = formData.get('loteId') as string;

        // 2. Tratamento Unificado de Boletos e NFs
        const files = [
            ...formData.getAll('files'),
            ...formData.getAll('file'),
            ...formData.getAll('files[]'),
            ...formData.getAll('boletos'),
            ...formData.getAll('nfse'),
            ...formData.getAll('nf')
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

        // 4. Encontra ou Cria a pasta no Google Drive usando o rootFolderId inteligente
        const loteFolderId = await findOrCreateFolder(folderName, rootFolderId);

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
                fields: 'id',
                supportsAllDrives: true
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
