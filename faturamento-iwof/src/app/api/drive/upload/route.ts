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
        // Camada 1: Busca Exata (Otimizada)
        const safeFolderName = folderName.replace(/'/g, "\\'");
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
            console.log(`[Drive Exact Match] Pasta encontrada: "${folderName}" → ${resExact.data.files[0].id}`);
            return resExact.data.files[0].id;
        }

        // Camada 2: Busca Inteligente (Fuzzy)
        console.log(`[Drive Fuzzy] Busca exata falhou para "${folderName}". Listando diretório pai...`);
        const resList = await drive.files.list({
            q: `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });

        if (resList.data.files && resList.data.files.length > 0) {
            const requestedNameUpper = folderName.trim().toUpperCase();
            
            // Lógica de Regex: Se a pasta no Drive tiver _, tratamos como coringa para bater com a pasta solicitada
            const foundFolder = resList.data.files.find(f => {
                const driveFolderName = f.name || "";
                const pattern = driveFolderName
                    .toUpperCase()
                    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex
                    .replace(/_/g, "[ &ÇÁÀÂÃÉÊÍÓÔÕÚ']"); // _ vira coringa
                const regex = new RegExp(`^${pattern}$`, 'i');
                return regex.test(requestedNameUpper);
            });

            if (foundFolder && foundFolder.id) {
                console.log(`[Drive Fuzzy Match] Pasta correspondente encontrada: "${foundFolder.name}" para o pedido "${folderName}" → ${foundFolder.id}`);
                return foundFolder.id;
            }
        }

        // Camada 3: Criação
        const fileMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId]
        };
        const createRes = await drive.files.create({
            requestBody: fileMetadata,
            fields: 'id, driveId',
            supportsAllDrives: true
        });

        const newId = createRes.data.id!;
        console.log(`[Drive Create] Pasta criada: "${folderName}" → ${newId}`);
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
        const results: { name: string, driveId: string }[] = [];

        // Ano/Mês: calculados uma única vez para o lote inteiro
        const now = new Date();
        const uploadAno = now.getFullYear().toString();
        const uploadMes = (now.getMonth() + 1).toString().padStart(2, '0');

        // Cache de IDs de pastas para evitar chamadas duplicadas na mesma requisição
        const folderCache: Record<string, string> = {};
        const folderPromises: Record<string, Promise<string>> = {}; // Mutex p/ evitar duplicação paralela

        // mesFolderId: se vier no metadata (chunks 2+), salta resolução de Ano e Mês
        // Se não vier (chunk 1), resolve e retorna para o frontend reutilizar
        let resolvedMesFolderId: string | null = (metadataArray[0]?.mesFolderId) || null;

        if (!resolvedMesFolderId) {
            const anoFolderId = await findOrCreateFolder(uploadAno, rootFolderId);
            resolvedMesFolderId = await findOrCreateFolder(uploadMes, anoFolderId);
        }

        // Helper genérico para dividir array em lotes menores
        const chunkArray = <T,>(arr: T[], size: number): T[][] => {
            return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
                arr.slice(i * size, i * size + size)
            );
        };

        // Lote de Concorrência (quantos PDFs farão upload simultâneo p/ o Drive)
        const CONCURRENT_LIMIT = 5;
        const metadataChunks = chunkArray(metadataArray, CONCURRENT_LIMIT);

        for (const metaChunk of metadataChunks) {
            const chunkPromises = metaChunk.map(async (meta: any) => {
                const file = files.find(f => f.name === meta.filename);
                if (!file) {
                    console.warn(`Arquivo ${meta.filename} não encontrado no FormData.`);
                    return;
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
                const cacheKey = `${resolvedMesFolderId}/${empresaParaPasta}/${nomePastaFinal}`;

                // Sistema de Cache + Mutex para evitar Race Conditions de 2 arquivos paralelos criarem a pasta ao mesmo tempo
                if (folderCache[cacheKey]) {
                    targetFolderId = folderCache[cacheKey];
                } else if (cacheKey in folderPromises) {
                    targetFolderId = (await folderPromises[cacheKey])!;
                    folderCache[cacheKey] = targetFolderId;
                } else {
                    folderPromises[cacheKey] = findOrCreatePath(resolvedMesFolderId as string, [empresaParaPasta, nomePastaFinal]);
                    targetFolderId = await folderPromises[cacheKey];
                    folderCache[cacheKey] = targetFolderId;
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
                results.push({ name: file.name, driveId: driveId || "" });

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
            });

            // Executa os 5 uploads desse lote concorrente antes do próximo
            await Promise.all(chunkPromises);
        }

        // Retorna mesFolderId para o frontend reutilizar nos chunks seguintes
        return NextResponse.json({ success: true, results, mesFolderId: resolvedMesFolderId });


    } catch (error: any) {
        console.error("Erro no API /drive/upload:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
