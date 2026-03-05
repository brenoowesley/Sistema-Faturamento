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

// ID da Unidade Compartilhada (Shared Drive) — diferente do ID da pasta de partida
const SHARED_DRIVE_ID = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID || '0AHsO4r32U6gpUk9PVA';

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

async function findOrCreateFolder(folderName: string, parentFolderId: string): Promise<string> {
    try {
        // Escape de aspas simples para a query da Drive API
        const safeFolderName = folderName.replace(/'/g, "\\'");

        const q = `name='${safeFolderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;

        // CORREÇÃO: Não usar driveId/corpora no files.list.
        // O filtro '${parentFolderId}' in parents já escopa a busca ao local correto.
        // Usar driveId+corpora com Service Account causava falso "não encontrado",
        // forçando criação de pastas duplicadas no My Drive da service account.
        const res = await drive.files.list({
            q,
            fields: 'files(id, name)',
            spaces: 'drive',
            pageSize: 1,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });

        if (res.data.files && res.data.files.length > 0 && res.data.files[0].id) {
            console.log(`[Drive Cache] Pasta encontrada: "${folderName}" → ${res.data.files[0].id}`);
            return res.data.files[0].id;
        }

        // Pasta não existe: criar dentro do pai (que está no Shared Drive)
        const fileMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId]
        };
        const createRes = await drive.files.create({
            requestBody: fileMetadata,
            fields: 'id, driveId',  // driveId no retorno confirma que está no Shared Drive
            supportsAllDrives: true
        });

        const newId = createRes.data.id!;
        const newDriveId = (createRes.data as any).driveId;
        console.log(`[Drive Create] Pasta criada: "${folderName}" → ${newId} | driveId: ${newDriveId || 'MY_DRIVE (ATENCAO!)'}`);

        if (newDriveId && newDriveId !== SHARED_DRIVE_ID) {
            console.error(`[Drive ALERTA] Pasta criada fora do Shared Drive! Criado em: ${newDriveId}, esperado: ${SHARED_DRIVE_ID}`);
        }

        return newId;
    } catch (error) {
        console.error('[Drive Error] findOrCreateFolder:', folderName, 'pai:', parentFolderId, error);
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

        // Ano/Mês: calculados uma única vez para o lote inteiro
        const now = new Date();
        const uploadAno = now.getFullYear().toString();
        const uploadMes = (now.getMonth() + 1).toString().padStart(2, '0');

        // Cache de IDs de pastas para evitar chamadas duplicadas na mesma requisição
        const folderCache: Record<string, string> = {};

        // mesFolderId: se vier no metadata (chunks 2+), salta resolução de Ano e Mês
        // Se não vier (chunk 1), resolve e retorna para o frontend reutilizar
        let resolvedMesFolderId: string | null = (metadataArray[0]?.mesFolderId) || null;

        for (const meta of metadataArray) {
            const file = files.find(f => f.name === meta.filename);
            if (!file) {
                console.warn(`Arquivo ${meta.filename} não encontrado no FormData.`);
                continue;
            }

            // --- Lógica de Pareamento Dinâmico ---
            let empresaParaPasta = (meta.nome_empresa_extraido || meta.nome_conta_azul || "Indefinido").trim();

            if (meta.docType === 'nf' && meta.numeroNF) {
                try {
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

            const nomePastaFinal = String(meta.nomePasta || meta.ciclo || "Geral").trim();

            let targetFolderId: string;

            if (resolvedMesFolderId) {
                // Chunks 2+: Ano e Mês já resolvidos — só precisa de empresa → nomePasta (2 chamadas)
                const cacheKey = `${resolvedMesFolderId}/${empresaParaPasta}/${nomePastaFinal}`;
                if (folderCache[cacheKey]) {
                    targetFolderId = folderCache[cacheKey];
                } else {
                    targetFolderId = await findOrCreatePath(resolvedMesFolderId, [empresaParaPasta, nomePastaFinal]);
                    folderCache[cacheKey] = targetFolderId;
                }
            } else {
                // Chunk 1: resolve caminho completo e captura mesFolderId no caminho
                const anoFolderId = await findOrCreateFolder(uploadAno, rootFolderId);
                resolvedMesFolderId = await findOrCreateFolder(uploadMes, anoFolderId);

                const cacheKey = `${resolvedMesFolderId}/${empresaParaPasta}/${nomePastaFinal}`;
                if (folderCache[cacheKey]) {
                    targetFolderId = folderCache[cacheKey];
                } else {
                    targetFolderId = await findOrCreatePath(resolvedMesFolderId, [empresaParaPasta, nomePastaFinal]);
                    folderCache[cacheKey] = targetFolderId;
                }
            }

            console.log(`[Drive Path] ${meta.filename} → ${uploadAno}/${uploadMes}/${empresaParaPasta}/${nomePastaFinal} → ${targetFolderId}`);

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

        // Retorna mesFolderId para o frontend reutilizar nos chunks seguintes
        return NextResponse.json({ success: true, results, mesFolderId: resolvedMesFolderId });


    } catch (error: any) {
        console.error("Erro no API /drive/upload:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
