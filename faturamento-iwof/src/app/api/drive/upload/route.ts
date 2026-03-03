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
    // Ordem de Prioridade: GOOGLE_DRIVE_ROOT_FOLDER_ID > DRIVE_FOLDER_URL
    const rawFolderEnv = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || process.env.DRIVE_FOLDER_URL;

    if (!rawFolderEnv) return null;

    // Sanitização: .trim() + remoção de caracteres invisíveis (Regex)
    const sanitizedInput = rawFolderEnv.trim().replace(/[\u200B-\u200D\uFEFF]/g, "");

    // Extração robusta: Se for URL, pega o ID após a última barra
    const extractedId = sanitizedInput.includes('drive.google.com')
        ? sanitizedInput.split('/').pop()?.split('?')[0]
        : sanitizedInput;

    // Validação da Raiz (Root ID Oficial iWof)
    const EXPECTED_ROOT_ID = '1vBylgUjKl1LC8-Ttf8rrL5CdEJYpi9AT';

    if (extractedId !== EXPECTED_ROOT_ID) {
        console.error(`[Drive API Audit] ERRO: ID Rejeitado (${extractedId}). Esperado: ${EXPECTED_ROOT_ID}`);
        throw new Error(`ID da pasta raiz inválido: ${extractedId}. Use o ID oficial da iWof.`);
    }

    console.log(`[Drive API Audit] ID da Raiz (${extractedId}) carregado com sucesso.`);
    return extractedId;
};

// 2. Configuração do Supabase Admin (Ignora RLS)
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function findOrCreateFolder(folderName: string, parentFolderId: string) {
    try {
        // Blindagem contra Apóstrofos (Escape de aspas simples para a API do Google Drive)
        const safeFolderName = folderName.replace(/'/g, "\\'");

        const q = `name='${safeFolderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;

        const res = await drive.files.list({
            q,
            fields: 'files(id, name)',
            spaces: 'drive',
            pageSize: 1,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            driveId: '1vBylgUjKl1LC8-Ttf8rrL5CdEJYpi9AT',
            corpora: 'drive'
        });

        if (res.data.files && res.data.files.length > 0 && res.data.files[0].id) {
            return res.data.files[0].id;
        } else {
            // Tratamento de Erros de Listagem: Verificação de permissão antes de criar
            try {
                await drive.files.get({
                    fileId: parentFolderId,
                    fields: 'id, capabilities',
                    supportsAllDrives: true
                });
            } catch (permError) {
                console.error(`[Drive API] Sem acesso de leitura na pasta pai (${parentFolderId}):`, permError);
                throw new Error(`Permissão insuficiente na pasta pai: ${parentFolderId}`);
            }

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

async function findOrCreatePath(rootFolderId: string, segments: string[]) {
    let currentParentId = rootFolderId;
    for (const segment of segments) {
        if (!segment) continue;
        const folderName = segment.trim();
        currentParentId = (await findOrCreateFolder(folderName, currentParentId)) as string;
        console.log(`[Drive Debug] Segmento: ${folderName} | Pai: ${currentParentId}`);
    }
    return currentParentId;
}

export async function POST(request: Request) {
    try {
        const rootFolderId = getRootFolderId();

        if (!rootFolderId) {
            console.error("ERRO: Variável de ambiente DRIVE_ROOT_FOLDER_ID ou similar ausente.");
            return NextResponse.json(
                { success: false, error: "Google Drive Root Folder não configurado." },
                { status: 500 }
            );
        }

        const formData = await request.formData();
        const metadataStr = formData.get('metadata') as string;
        if (!metadataStr) throw new Error("Metadados não fornecidos.");

        const metadataArray = JSON.parse(metadataStr);
        const entries = formData.getAll('files');
        const files = entries as File[];

        if (!files || files.length === 0) throw new Error("Nenhum arquivo recebido.");

        console.log(`[Drive API] Processando lote de ${files.length} arquivos.`);

        const { Readable } = require('stream');
        const results = [];

        // Cache de IDs de pastas para evitar chamadas duplicadas na mesma requisição
        const folderCache: Record<string, string> = {};

        for (const meta of metadataArray) {
            const file = files.find(f => f.name === meta.filename);
            if (!file) {
                console.warn(`Arquivo ${meta.filename} não encontrado no FormData.`);
                continue;
            }

            // --- Lógica de Pareamento Dinâmico (Phase 9) ---
            let empresaParaPasta = (meta.nome_empresa_extraido || meta.nome_conta_azul || "Indefinido").trim();

            if (meta.docType === 'nf' && meta.numeroNF) {
                try {
                    // Busca na tabela faturamento_consolidados pelo número da nota
                    const { data: consData, error: consErr } = await supabaseAdmin
                        .from('faturamento_consolidados')
                        .select('nome_empresa')
                        .eq('numero_nf', meta.numeroNF)
                        .maybeSingle();

                    if (!consErr && consData?.nome_empresa) {
                        empresaParaPasta = consData.nome_empresa.trim();
                        console.log(`[Drive Pairing] NF ${meta.numeroNF} vinculada à empresa: ${empresaParaPasta}`);
                    }
                } catch (e) {
                    console.error(`[Drive Pairing Error] Falha ao buscar empresa para NF ${meta.numeroNF}:`, e);
                }
            }

            // 1. Construir árvore de pastas: [Ano] -> [Mês] -> [Empresa] -> [Ciclo]
            const segments = [
                meta.ano,
                meta.mes,
                empresaParaPasta,
                meta.ciclo
            ].map(s => String(s || "Indefinido").trim());

            const cacheKey = segments.join('/');
            let targetFolderId = folderCache[cacheKey];

            if (!targetFolderId) {
                targetFolderId = await findOrCreatePath(rootFolderId, segments);
                folderCache[cacheKey] = targetFolderId;
            }

            // 2. Upload para o Drive
            const buffer = Buffer.from(await file.arrayBuffer());
            const fileMetadata = {
                name: file.name,
                parents: [targetFolderId]
            };
            const media = {
                mimeType: file.type || 'application/pdf',
                body: Readable.from(buffer)
            };

            console.log(`[Drive Debug] Uploading ${file.name} para a pasta final: ${targetFolderId}`);
            console.log(`[Drive API] Destino Final do Arquivo [${file.name}]:`, targetFolderId);

            const driveRes = await drive.files.create({
                requestBody: fileMetadata,
                media: media,
                fields: 'id',
                supportsAllDrives: true
            });

            const driveId = driveRes.data.id;
            results.push({ name: file.name, driveId });

            // 3. Feedback Loop p/ Supabase
            if (meta.consolidadoId && driveId) {
                const updateData: any = {};
                if (meta.docType === 'nf') {
                    updateData.drive_id_nf = driveId;
                    updateData.status_drive_nf = 'SINCRONIZADO';
                } else if (meta.docType === 'hc' || meta.docType === 'boleto') {
                    updateData.drive_id_hc = driveId;
                    updateData.status_drive_hc = 'SINCRONIZADO';
                }

                const { error: upErr } = await supabaseAdmin
                    .from('faturamento_consolidados')
                    .update(updateData)
                    .eq('id', meta.consolidadoId);

                if (upErr) console.error(`[Supabase Error] ${meta.consolidadoId}:`, upErr);
            }
        }

        return NextResponse.json({ success: true, results });

    } catch (error: any) {
        console.error("Erro no API /drive/upload:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
