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
        const consolidadoId = formData.get('consolidadoId') as string; // Requerido para feedback individual
        const docType = formData.get('docType') as string; // 'nf' ou 'hc'

        // 2. Coleta de arquivos (suporta 'file' individual ou 'files' array)
        const entries = formData.getAll('file').length > 0 ? formData.getAll('file') : formData.getAll('files');
        const files = entries as File[];

        if (!loteId) throw new Error("ID do Lote não fornecido.");
        if (!files || files.length === 0) throw new Error("Nenhum arquivo recebido.");

        console.log(`[Next.js API] Upload para Lote ${loteId} | Consolidado: ${consolidadoId || 'Geral'} | Tipo: ${docType || 'N/A'}`);

        // 3. Busca informações do Lote
        const { data: lote, error: loteErr } = await supabaseAdmin
            .from('faturamentos_lote')
            .select('nome_pasta, data_competencia, drive_folder_id')
            .eq('id', loteId)
            .single();

        if (loteErr || !lote) throw new Error("Lote não encontrado.");

        let loteFolderId = lote.drive_folder_id;
        if (!loteFolderId) {
            const folderName = lote.nome_pasta || `Lote ${lote.data_competencia}`;
            loteFolderId = await findOrCreateFolder(folderName, rootFolderId);
            await supabaseAdmin.from('faturamentos_lote').update({ drive_folder_id: loteFolderId }).eq('id', loteId);
        }

        // 4. Processamento de Uploads
        const { Readable } = require('stream');
        const results = [];

        for (const file of files) {
            const buffer = Buffer.from(await file.arrayBuffer());
            const fileMetadata = {
                name: file.name,
                parents: [loteFolderId as string]
            };
            const media = {
                mimeType: file.type || 'application/pdf',
                body: Readable.from(buffer)
            };

            const driveRes = await drive.files.create({
                requestBody: fileMetadata,
                media: media,
                fields: 'id',
                supportsAllDrives: true
            });

            const driveId = driveRes.data.id;
            results.push({ name: file.name, driveId });

            // 5. Feedback Loop p/ Supabase (Se houver consolidadoId)
            if (consolidadoId && driveId && docType) {
                const updateData: any = {};
                if (docType === 'nf') {
                    updateData.drive_id_nf = driveId;
                    updateData.status_drive_nf = 'SINCRONIZADO';
                } else if (docType === 'hc') {
                    updateData.drive_id_hc = driveId;
                    updateData.status_drive_hc = 'SINCRONIZADO';
                }

                const { error: upErr } = await supabaseAdmin
                    .from('faturamento_consolidados')
                    .update(updateData)
                    .eq('id', consolidadoId);

                if (upErr) console.error(`[Supabase Feedback Error] ${consolidadoId}:`, upErr);
            }
        }

        return NextResponse.json({ success: true, results });

    } catch (error: any) {
        console.error("Erro no API /drive/upload:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
