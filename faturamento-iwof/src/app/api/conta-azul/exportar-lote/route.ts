import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

const API_BASE = "https://api-v2.contaazul.com";

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

        let successCount = 0;
        let errorCount = 0;
        const errors: { id: string; cliente: string; erro: string }[] = [];

        // 3. Cache de resolução CNPJ → UUID (evita chamadas duplicadas)
        const contatoCache = new Map<string, string | null>();

        // 4. Integração Principal — API v2 Financeiro (Contas a Receber)
        // Endpoint: POST /v1/financeiro/eventos-financeiros/contas-a-receber
        // Spec: EventoFinanceiroRequest
        const ENDPOINT = "/v1/financeiro/eventos-financeiros/contas-a-receber";

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
                    erro: `Categoria Financeira para o ciclo (${item.categoria}) não configurada. Defina CA_CATEGORY_SEMANAL, CA_CATEGORY_QUINZENAL ou CA_CATEGORY_MENSAL no .env.` 
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
                    erro: `Cliente não encontrado no Conta Azul pelo CNPJ: ${item.cnpj}. Cadastre o cliente primeiro.` 
                });
                continue;
            }

            // 4c. Monta o payload conforme OpenAPI spec (EventoFinanceiroRequest)
            const payload = {
                data_competencia: item.dataCompetencia,         // "2024-07-15" (ISO date)
                valor: item.valor,                              // number
                observacao: item.observacoes || "",              // string (required)
                descricao: item.descricao || "Prestação de serviço", // string (required)
                contato: contatoUUID,                           // UUID (required) — resolvido via API Pessoas
                conta_financeira: bankAccountId,                // UUID (required)
                rateio: [
                    {
                        id_categoria: categoryId,               // UUID da categoria
                        valor: item.valor                       // valor do rateio = valor total
                    }
                ],
                condicao_pagamento: {
                    parcelas: [
                        {
                            descricao: item.descricao || "Faturamento",  // string (required)
                            data_vencimento: item.dataVencimento,        // "2024-07-15" (ISO date, required)
                            nota: item.observacoes || "",                // string (required)
                            conta_financeira: bankAccountId,             // UUID (required)
                            detalhe_valor: {
                                valor_bruto: item.valor,   // number (required)
                                valor_liquido: item.valor  // required na prática (mesmo valor quando não há desconto)
                            }
                        }
                    ]
                }
            };

            try {
                // ── PASSO 1: Cria o evento financeiro (Conta a Receber) ──────────
                const response = await fetch(`${API_BASE}${ENDPOINT}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${accessToken}`
                    },
                    body: JSON.stringify(payload)
                });
                
                // A API retorna 202 (Accepted) em caso de sucesso
                if (!response.ok) {
                    const rawText = await response.text();
                    let errMsg = response.statusText;
                    try {
                        const errObj = JSON.parse(rawText);
                        errMsg = typeof errObj.message === "string" 
                            ? errObj.message 
                            : JSON.stringify(errObj.message || errObj.errors || errObj);
                    } catch { errMsg = rawText || response.statusText; }
                    console.error(`🚨 Conta Azul API Error [${response.status}] para ${item.cliente}:`, errMsg);
                    throw new Error(`Erro API (${response.status}): ${errMsg}`);
                }

                const eventoResult = await response.json().catch(() => ({}));
                console.log(`✅ Evento criado para ${item.cliente}: protocolId=${eventoResult.protocolId}, status=${eventoResult.status}`);

                // ── PASSO 2: Aguarda processamento assíncrono (202 é enfileirado) ──
                // A criação é assíncrona — aguardamos antes de buscar a parcela
                await new Promise(resolve => setTimeout(resolve, 3000));

                // ── PASSO 3: Busca o id da parcela recém-criada ──────────────────
                // Filtra por data de vencimento e contato para achar a parcela correta
                const buscaParams = new URLSearchParams({
                    pagina: "1",
                    tamanho_pagina: "10",
                    data_vencimento_de: item.dataVencimento,
                    data_vencimento_ate: item.dataVencimento,
                    ids_clientes: contatoUUID
                });

                const buscaRes = await fetch(
                    `${API_BASE}/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?${buscaParams}`,
                    {
                        headers: {
                            "Authorization": `Bearer ${accessToken}`,
                            "Content-Type": "application/json"
                        }
                    }
                );

                let idParcela: string | null = null;

                if (buscaRes.ok) {
                    const buscaData = await buscaRes.json();
                    const parcelas: any[] = buscaData.itens || [];
                    // Pega a parcela mais recente (última inserida) com o valor correto
                    const parcelaMatch = parcelas.find(p => 
                        Math.abs(p.total - item.valor) < 0.01
                    );
                    idParcela = parcelaMatch?.id || null;
                    if (idParcela) {
                        console.log(`📋 Parcela encontrada para ${item.cliente}: id=${idParcela}`);
                    } else {
                        console.warn(`⚠️ Parcela não encontrada para ${item.cliente} (venc: ${item.dataVencimento}, valor: ${item.valor})`);
                    }
                } else {
                    console.warn(`⚠️ Falha ao buscar parcelas para ${item.cliente}: ${buscaRes.status}`);
                }

                // ── PASSO 4: Gera o Boleto (não-fatal se falhar) ─────────────────
                if (idParcela) {
                    const boletoPayload = {
                        conta_bancaria: bankAccountId, // Mesmo ID da conta financeira
                        descricao_fatura: item.descricao || `Faturamento ${item.cliente}`,
                        id_parcela: idParcela,
                        data_vencimento: item.dataVencimento,
                        tipo: "BOLETO"
                    };

                    const boletoRes = await fetch(
                        `${API_BASE}/v1/financeiro/eventos-financeiros/contas-a-receber/gerar-cobranca`,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${accessToken}`
                            },
                            body: JSON.stringify(boletoPayload)
                        }
                    );

                    if (boletoRes.ok) {
                        const boletoData = await boletoRes.json().catch(() => ({}));
                        console.log(`🎫 Boleto gerado para ${item.cliente}: id=${boletoData.id}, status=${boletoData.status}`);
                    } else {
                        const boletoErrText = await boletoRes.text().catch(() => "");
                        // Boleto falhou — não é fatal, evento já foi criado com sucesso
                        console.warn(`⚠️ Boleto não gerado para ${item.cliente} [${boletoRes.status}]: ${boletoErrText}`);
                    }
                }

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
            errors
        });

    } catch (error: any) {
        console.error("Erro na exportação para Conta Azul:", error);
        return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 });
    }
}
