import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

const API_BASE = "https://api-v2.contaazul.com";
const RECEIVABLE_ENDPOINT = `${API_BASE}/v1/financeiro/eventos-financeiros/contas-a-receber`;

// ─── Motor de Renovação OAuth2 ──────────────────────────────────

async function getValidToken() {
    const clientId = process.env.CA_CLIENT_ID?.trim();
    const clientSecret = process.env.CA_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
        throw new Error("Credenciais do Conta Azul (Client ID ou Secret) estão ausentes no servidor.");
    }

    const { data: tokenData, error: tokenErr } = await supabaseAdmin
        .from('conta_azul_tokens')
        .select('refresh_token')
        .eq('id', 'padrao')
        .single();

    if (tokenErr || !tokenData?.refresh_token) {
        throw new Error("Refresh token não encontrado no banco de dados.");
    }

    const refreshToken = tokenData.refresh_token;

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId
    });

    const response = await fetch("https://auth.contaazul.com/oauth2/token", {
        method: "POST",
        headers: {
            "Authorization": `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: body.toString()
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(`Falha ao renovar token OAuth2 Conta Azul: ${data.error_description || data.error || response.statusText}`);
    }

    // Persiste o novo refresh_token (single-use Cognito)
    if (data.refresh_token) {
        const { error: updateErr } = await supabaseAdmin
            .from('conta_azul_tokens')
            .update({ 
                refresh_token: data.refresh_token, 
                updated_at: new Date().toISOString() 
            })
            .eq('id', 'padrao');

        if (updateErr) {
            console.error("🚨 CRÍTICO: Falha ao salvar novo refresh_token no banco. O token antigo já foi consumido!", updateErr);
        }
    }

    return data.access_token;
}

// ─── Resolução CNPJ → UUID (API Pessoas v1) ────────────────────

/**
 * Busca o UUID do contato no Conta Azul pelo CNPJ.
 * Usa GET /v1/pessoas?documentos={cnpj_limpo}
 * Retorna o UUID ou null se não encontrar.
 */
async function resolverContatoPorCNPJ(
    cnpj: string, 
    accessToken: string, 
    cache: Map<string, string | null>
): Promise<string | null> {
    // Normaliza removendo pontuação
    const cnpjLimpo = (cnpj || "").replace(/\D/g, "");
    
    if (!cnpjLimpo) return null;
    
    // Checa cache para evitar chamadas repetidas ao mesmo CNPJ
    if (cache.has(cnpjLimpo)) return cache.get(cnpjLimpo)!;

    try {
        const url = `${API_BASE}/v1/pessoas?documentos=${cnpjLimpo}&tamanho_pagina=10&pagina=1`;
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            console.error(`⚠️ Falha ao buscar pessoa por CNPJ ${cnpjLimpo}: ${response.status}`);
            cache.set(cnpjLimpo, null);
            return null;
        }

        const data = await response.json();
        const items = data.items || [];

        if (items.length > 0) {
            const uuid = items[0].id;
            console.log(`✅ CNPJ ${cnpjLimpo} → UUID ${uuid} (${items[0].nome})`);
            cache.set(cnpjLimpo, uuid);
            return uuid;
        }

        console.warn(`⚠️ Nenhuma pessoa encontrada para CNPJ: ${cnpjLimpo}`);
        cache.set(cnpjLimpo, null);
        return null;

    } catch (err) {
        console.error(`❌ Erro ao buscar pessoa por CNPJ ${cnpjLimpo}:`, err);
        cache.set(cnpjLimpo, null);
        return null;
    }
}

// ─── Resolução Centro de Custo (Nome → UUID) ───────────────────

/**
 * Busca o UUID do centro de custo no Conta Azul pelo nome (ex: "Paraíba").
 * Usa GET /v1/centro-de-custo?busca={nome}
 * Retorna o UUID ou null se não encontrar.
 */
async function resolverCentroCustoPorNome(
    nome: string,
    accessToken: string,
    cache: Map<string, string | null>
): Promise<string | null> {
    const nomeLimpo = (nome || "").trim();
    if (!nomeLimpo) return null;

    if (cache.has(nomeLimpo)) return cache.get(nomeLimpo)!;

    try {
        const params = new URLSearchParams({
            pagina: "1",
            tamanho_pagina: "100",
            busca: nomeLimpo,
            filtro_rapido: "ATIVO"
        });
        const url = `${API_BASE}/v1/centro-de-custo?${params}`;
        const response = await fetch(url, {
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            console.error(`⚠️ Falha ao buscar centro de custo "${nomeLimpo}": ${response.status}`);
            cache.set(nomeLimpo, null);
            return null;
        }

        const data = await response.json();
        const items = data.items || [];

        // Busca match exato por nome (case-insensitive)
        const match = items.find((cc: any) =>
            cc.nome?.toLowerCase() === nomeLimpo.toLowerCase()
        ) || items[0]; // Fallback para o primeiro resultado

        if (match) {
            console.log(`✅ Centro de custo "${nomeLimpo}" → UUID ${match.id} (${match.nome})`);
            cache.set(nomeLimpo, match.id);
            return match.id;
        }

        console.warn(`⚠️ Nenhum centro de custo encontrado para: "${nomeLimpo}"`);
        cache.set(nomeLimpo, null);
        return null;

    } catch (err) {
        console.error(`❌ Erro ao buscar centro de custo "${nomeLimpo}":`, err);
        cache.set(nomeLimpo, null);
        return null;
    }
}

// ─── Mapeamento de Categoria por Ciclo ──────────────────────────

/**
 * Resolve o UUID da categoria financeira a partir do nome do ciclo.
 *
 * Estratégia (em ordem):
 * 1. Extrai a chave de dentro dos parênteses: "FATURAMENTO (QUEIROZ)" → "QUEIROZ"
 *    e busca CA_CATEGORY_QUEIROZ no .env.
 * 2. Verificações explícitas para os ciclos padrão (SEMANAL, QUINZENAL, MENSAL).
 * 3. Fallback genérico: CA_CATEGORY_DEFAULT.
 *
 * Para adicionar um novo ciclo, basta criar a env var no Vercel:
 *   CA_CATEGORY_QUEIROZ=<uuid>
 *   CA_CATEGORY_NORDESTAO=<uuid>
 *   etc.
 */
function getCategoriaEnv(categoriaString: string): string {
    const str = (categoriaString || "").toUpperCase().trim();

    // 1. Tenta extrair a chave do interior dos parênteses: "FATURAMENTO (QUEIROZ)"
    const match = str.match(/\(([^)]+)\)/);
    if (match) {
        // Normaliza: remove espaços/acentos incompatíveis com nomes de env vars
        const chave = match[1].trim().replace(/\s+/g, "_");
        const envKey = `CA_CATEGORY_${chave}`;
        const valor = process.env[envKey];
        if (valor) return valor;
    }

    // 2. Aliases explícitos para ciclos padrão (compatibilidade retroativa)
    if (str.includes("SEMANAL"))   return process.env.CA_CATEGORY_SEMANAL   || "";
    if (str.includes("QUINZENAL")) return process.env.CA_CATEGORY_QUINZENAL || "";
    if (str.includes("MENSAL"))    return process.env.CA_CATEGORY_MENSAL    || "";

    // 3. Fallback genérico
    return process.env.CA_CATEGORY_DEFAULT || "";
}

// ─── Handler Principal ──────────────────────────────────────────

export async function POST(req: Request) {
    try {
        const rows = await req.json();

        if (!Array.isArray(rows)) {
            return NextResponse.json({ error: "O payload deve ser um array." }, { status: 400 });
        }

        // 1. Autenticação — Busca Token Fresco
        let accessToken: string;
        try {
            accessToken = await getValidToken();
        } catch (tokenErr: any) {
            console.error("Erro na autenticação:", tokenErr);
            return NextResponse.json({ error: tokenErr.message }, { status: 401 });
        }

        // 2. Validação de variáveis de ambiente
        const bankAccountId = process.env.CONTA_AZUL_BANK_ACCOUNT_ID;
        if (!bankAccountId) {
            return NextResponse.json({ error: "CONTA_AZUL_BANK_ACCOUNT_ID não está configurado." }, { status: 500 });
        }

        // Conta PJ de cobrança: usada como `conta_cobranca_id` na parcela
        // para que o Conta Azul emita o boleto vinculado a esta conta bancária.
        // Configure CA_BOLETO_BANK_ACCOUNT_ID na Vercel com o UUID da conta PJ.
        // Fallback: usa a própria conta financeira principal.
        const boletoAccountId = process.env.CA_BOLETO_BANK_ACCOUNT_ID || bankAccountId;

        let successCount = 0;
        let errorCount = 0;
        const errors: { id: string; cliente: string; erro: string }[] = [];

        // 3. Caches de resolução (evitam chamadas duplicadas)
        const contatoCache = new Map<string, string | null>();
        const centroCustoCache = new Map<string, string | null>();

        // 4. Integração Principal — Contas a Receber
        // Endpoint: POST /v1/financeiro/eventos-financeiros/contas-a-receber (API v2)
        // Cria um lançamento financeiro direto no módulo de contas a receber,
        // sem gerar NF ou venda — apenas o título financeiro com boleto bancário.

        for (const item of rows) {
            if (!item.valor || item.valor <= 0) {
                continue;
            }

            // 4a. Resolve a categoria baseada no ciclo ("FATURAMENTO (MENSAL)")
            const categoryId = getCategoriaEnv(item.categoria);

            if (!categoryId) {
                errorCount++;
                errors.push({
                    id: item.id,
                    cliente: item.cliente,
                    erro: `Categoria Financeira para o ciclo (${item.categoria}) não configurada. Defina CA_CATEGORY_SEMANAL, CA_CATEGORY_QUINZENAL ou CA_CATEGORY_MENSAL no .env.`,
                });
                continue;
            }

            // 4b. Resolve CNPJ → UUID do contato via API Pessoas
            const contatoUUID = await resolverContatoPorCNPJ(item.cnpj, accessToken, contatoCache);

            if (!contatoUUID) {
                errorCount++;
                errors.push({
                    id: item.id,
                    cliente: item.cliente,
                    erro: `Cliente não encontrado no Conta Azul pelo CNPJ: ${item.cnpj}. Cadastre o cliente primeiro.`,
                });
                continue;
            }

            // 4c. Resolve Centro de Custo → UUID (opcional, não bloqueia exportação)
            const centroCustoUUID = item.centroCusto
                ? await resolverCentroCustoPorNome(item.centroCusto, accessToken, centroCustoCache)
                : null;

            // 4d. Monta payload para Contas a Receber (API v2)
            // Schema: evento financeiro com parcela única e método BANKING_BILLET
            const dataCompetencia = item.dataCompetencia
                ? new Date(item.dataCompetencia).toISOString().split("T")[0]  // "YYYY-MM-DD"
                : new Date().toISOString().split("T")[0];

            const dataVencimento = item.dataVencimento
                ? new Date(item.dataVencimento).toISOString().split("T")[0]
                : dataCompetencia;

            const payload: Record<string, unknown> = {
                // Identificação do devedor
                pessoa_id: contatoUUID,

                // Data de competência (emissão do lançamento)
                data_competencia: dataCompetencia,

                // Descrição do lançamento
                descricao: item.descricao || `Faturamento Mensal - ${item.cliente}`,

                // Categoria financeira (UUID)
                categoria_id: categoryId,

                // Conta bancária de recebimento (UUID)
                conta_financeira_id: bankAccountId,

                // Observações
                observacao: item.observacoes || "Gerado via Integração iWof",

                // Parcelas — lançamento único com boleto bancário
                parcelas: [
                    {
                        valor: item.valor,
                        data_vencimento: dataVencimento,
                        // Método de pagamento: boleto bancário
                        metodo_pagamento: "BANKING_BILLET",
                        // Conta PJ de cobrança: permite ao Conta Azul emitir o boleto
                        // no momento do lançamento (vinculado à conta bancária PJ)
                        conta_cobranca_id: boletoAccountId,
                    },
                ],

                // Centro de custo (opcional)
                ...(centroCustoUUID ? { centro_de_custo_id: centroCustoUUID } : {}),
            };

            try {
                // ── Cria o lançamento de contas a receber via API v2 ────────────
                const response = await fetch(RECEIVABLE_ENDPOINT, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${accessToken}`,
                    },
                    body: JSON.stringify(payload),
                });

                if (!response.ok) {
                    const rawText = await response.text();
                    let errMsg = response.statusText;
                    try {
                        const errObj = JSON.parse(rawText);
                        errMsg =
                            typeof errObj.message === "string"
                                ? errObj.message
                                : JSON.stringify(errObj.message || errObj.errors || errObj);
                    } catch {
                        errMsg = rawText || response.statusText;
                    }
                    console.error(`🚨 Conta Azul API Error [${response.status}] para ${item.cliente}:`, errMsg);
                    throw new Error(`Erro API (${response.status}): ${errMsg}`);
                }

                const result = await response.json().catch(() => ({}));
                console.log(`✅ Contas a receber criado para ${item.cliente}: id=${result.id}`);

                // Rate limit: 300ms de intervalo entre chamadas (limite: 600/min)
                await new Promise((resolve) => setTimeout(resolve, 300));

                successCount++;
            } catch (err: any) {
                errorCount++;
                errors.push({ id: item.id, cliente: item.cliente, erro: err.message });
            }
        }

        return NextResponse.json({
            message: "Sincronização concluída",
            successCount,
            errorCount,
            errors,
        });

    } catch (error: any) {
        console.error("Erro na exportação para Conta Azul:", error);
        return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 });
    }
}
