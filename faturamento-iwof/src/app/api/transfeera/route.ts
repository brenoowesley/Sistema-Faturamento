import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ─── Token Cache ────────────────────────────────────────────────────────────────
let cachedTransfeeraToken: string | null = null;
let tokenExpiryTime: number | null = null;

async function getTransfeeraToken() {
    if (cachedTransfeeraToken && tokenExpiryTime && Date.now() < tokenExpiryTime) {
        return cachedTransfeeraToken;
    }

    const clientId = process.env.TRANSFEERA_CLIENT_ID;
    const clientSecret = process.env.TRANSFEERA_CLIENT_SECRET;

    const loginBase = process.env.TRANSFEERA_ENV === "sandbox"
        ? "https://login-api-sandbox.transfeera.com"
        : "https://login-api.transfeera.com";

    if (!clientId || !clientSecret) {
        console.error("Transfeera Error: Missing TRANSFEERA_CLIENT_ID or TRANSFEERA_CLIENT_SECRET");
        throw new Error("Configuração de API ausente no servidor");
    }

    const response = await fetch(`${loginBase}/authorization`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
        },
        body: JSON.stringify({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret
        })
    });

    if (!response.ok) {
        const errBody = await response.text();
        console.error(`Transfeera Auth Error: Status ${response.status} - Body: ${errBody}`);
        throw new Error(`Transfeera Auth Error: ${response.status}`);
    }

    const data = await response.json();
    cachedTransfeeraToken = data.access_token;
    const expiresInSecs = data.expires_in || 3600;
    tokenExpiryTime = Date.now() + (expiresInSecs - 60) * 1000;

    return cachedTransfeeraToken;
}

function getTransfeeraBaseUrl() {
    return process.env.TRANSFEERA_ENV === "sandbox"
        ? "https://api-sandbox.transfeera.com"
        : "https://api.transfeera.com";
}

// ─── Status Normalizer ──────────────────────────────────────────────────────────
function normalizeTransfeeraStatus(raw: string): string {
    if (!raw) return "NAO_SUBMETIDO";
    const s = raw.toUpperCase().trim();
    const map: Record<string, string> = {
        FINALIZADO: "FINALIZADO",
        EFETIVADO: "EFETIVADO",
        PAGO: "FINALIZADO",
        CONCLUIDO: "FINALIZADO",
        CONCLUÍDO: "FINALIZADO",
        EM_PROCESSAMENTO: "EM_PROCESSAMENTO",
        PROCESSANDO: "EM_PROCESSAMENTO",
        EM_PROCESSAMENTO_BANCO: "EM_PROCESSAMENTO",
        AGENDADO: "AGENDADO",
        SCHEDULED: "AGENDADO",
        DEVOLVIDO: "DEVOLVIDO",
        RETURNED: "DEVOLVIDO",
        FALHA: "FALHA",
        FAILED: "FALHA",
        ERROR: "FALHA",
        CRIADO: "AGENDADO",
        CREATED: "AGENDADO",
    };
    return map[s] ?? raw;
}

/**
 * Formata a chave PIX conforme as exigências da Transfeera.
 * Especialmente para TELEFONE, que exige o formato E.164 (+55...)
 */
function formatarChavePix(tipo: string, chave: string): string {
    const t = tipo.toUpperCase();
    const c = chave.trim();
    
    if (t === "TELEFONE") {
        // Remove tudo que não for número
        const apenasNumeros = c.replace(/\D/g, "");
        
        // Se tem 10 ou 11 dígitos (DDD + Número), assume Brasil e põe +55
        if (apenasNumeros.length === 10 || apenasNumeros.length === 11) {
            return `+55${apenasNumeros}`;
        }
        
        // Se já começa com 55 e tem 12 ou 13 dígitos, apenas adiciona o +
        if (apenasNumeros.startsWith("55") && (apenasNumeros.length === 12 || apenasNumeros.length === 13)) {
            return `+${apenasNumeros}`;
        }
        
        return c; // Caso não se encaixe, envia original (deixando a API validar)
    }
    
    return c;
}

const UA_HEADER = "IWOF - Sistema de Faturamento (breno@iwof.com.br)";

// ─── POST Handler ───────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
        }

        const body = await req.json();
        const action = body.action;
        const token = await getTransfeeraToken();
        const baseUrl = getTransfeeraBaseUrl();
        const env = process.env.TRANSFEERA_ENV || "production";

        // ═══════════════════════════════════════════════════════════════════════
        // ACTION: create_batch — Cria um lote de pagamento direto na Transfeera
        // ═══════════════════════════════════════════════════════════════════════
        if (action === "create_batch") {
            const { lote_nome, items } = body as {
                lote_nome: string;
                items: Array<{
                    id: string;           // integration_id (UUID local)
                    valor_real: number;
                    tipo_pix: string;
                    chave_pix: string;
                    cpf_favorecido: string;
                }>;
            };

            if (!lote_nome || !items || items.length === 0) {
                return NextResponse.json({ error: "Lote sem nome ou sem itens" }, { status: 400 });
            }

            console.log(`[Transfeera] ▶ create_batch: Iniciando 3 passos para "${lote_nome}" com ${items.length} transferência(s) | Ambiente: ${env}`);

            // Normalizar tipo_pix para o formato que a Transfeera aceita
            function normalizePixKeyType(tipo: string): string {
                const map: Record<string, string> = {
                    "EMAIL": "EMAIL",
                    "CPF": "CPF",
                    "CNPJ": "CNPJ",
                    "TELEFONE": "TELEFONE",
                    "CHAVE_ALEATORIA": "CHAVE_ALEATORIA",
                    "EVP": "CHAVE_ALEATORIA",
                    "ALEATORIO": "CHAVE_ALEATORIA",
                };
                return map[tipo.toUpperCase()] || tipo;
            }

            // ==========================================
            // PASSO 1: CRIAR O LOTE VAZIO
            // ==========================================
            console.log(`[Transfeera] Passo 1: Criando lote vazio...`);
            const batchPayload = {
                name: lote_nome,
                type: "TRANSFERENCIA",
                auto_close: true // Permitido, fecha logo após todos os itens serem enviados
            };

            const batchRes = await fetch(`${baseUrl}/batch`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "User-Agent": UA_HEADER,
                },
                body: JSON.stringify(batchPayload),
            });

            const batchBody = await batchRes.json();
            
            if (!batchRes.ok) {
                console.error(`[Transfeera] ❌ Passo 1 (POST /batch) FALHOU:`, JSON.stringify(batchBody));
                return NextResponse.json({
                    error: batchBody.message || "Erro ao criar lote vazio na Transfeera",
                    details: batchBody
                }, { status: batchRes.status });
            }

            const batchId = batchBody.id;
            console.log(`✅ [Transfeera] Passo 1 Concluído: Lote ID ${batchId} criado.`);

            // ==========================================
            // PASSO 2: INSERIR TRANSFERÊNCIAS E CAPTURAR IDs
            // ==========================================
            console.log(`[Transfeera] Passo 2: Inserindo ${items.length} transferências no lote ${batchId}...`);
            const transfersPayload = items.map((item) => ({
                value: item.valor_real,
                integration_id: item.id, // Mapeamento CRÍTICO
                pix_description: "REPASSE IWOF",
                destination_bank_account: {
                    pix_key_type: normalizePixKeyType(item.tipo_pix),
                    pix_key: formatarChavePix(item.tipo_pix, item.chave_pix),
                },
                pix_key_validation: {
                    cpf_cnpj: item.cpf_favorecido.replace(/\D/g, ""),
                },
            }));

            const transfersRes = await fetch(`${baseUrl}/batch/${batchId}/transfer`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "User-Agent": UA_HEADER,
                },
                body: JSON.stringify(transfersPayload),
            });

            const transfersBody = await transfersRes.json();

            if (!transfersRes.ok) {
                console.error(`[Transfeera] ❌ Passo 2 (POST /transfer) FALHOU:`, JSON.stringify(transfersBody));
                
                // Extrair erros individuais
                const transferErrors: string[] = [];
                if (transfersBody.errors && Array.isArray(transfersBody.errors)) {
                    for (const err of transfersBody.errors) {
                        transferErrors.push(`${err.integration_id || "?"}: ${err.message || JSON.stringify(err)}`);
                    }
                }

                return NextResponse.json({
                    error: transfersBody.message || "Erro ao inserir transferências no lote",
                    details: transfersBody,
                    transferErrors
                }, { status: transfersRes.status });
            }

            const createdTransfers = Array.isArray(transfersBody) ? transfersBody : (transfersBody.data || []);
            console.log(`✅ [Transfeera] Passo 2 Concluído: ${createdTransfers.length} transferências inseridas.`);

            // ==========================================
            // PASSO 3: SALVAR IDs NO SUPABASE
            // ==========================================
            console.log(`[Transfeera] Passo 3: Vinculando IDs gerados ao banco de dados local...`);
            const updatePromises = [];
            
            for (const remote of createdTransfers) {
                if (remote.integration_id && remote.id) {
                    updatePromises.push(
                        supabase
                            .from("itens_saque")
                            .update({ transfeera_transfer_id: String(remote.id) })
                            .eq("id", remote.integration_id)
                    );
                }
            }

            if (updatePromises.length > 0) {
                const results = await Promise.all(updatePromises);
                const errors = results.filter(r => r.error);
                if (errors.length > 0) {
                    console.error(`[Transfeera] ⚠️ Falha ao salvar algumas atualizações no Supabase:`, errors);
                } else {
                    console.log(`✅ [Transfeera] Passo 3 Concluído: ${updatePromises.length} itens atualizados localmente.`);
                }
            } else {
                console.log(`⚠️ [Transfeera] Passo 3: Nenhum item para atualizar no banco.`);
            }

            return NextResponse.json({
                success: true,
                batch_id: String(batchId),
                batchId: batchId,
            });
        }

        // ═══════════════════════════════════════════════════════════════════════
        // ACTION: status_batch — Rastreio Otimizado (Consulta direta por ID)
        // ═══════════════════════════════════════════════════════════════════════
        if (action === "status_batch") {
            const items: Array<{ id_interno: string; transfeera_id: string }> = body.items;

            if (!items || items.length === 0) {
                console.log("[Transfeera] ⚠️ status_batch recebido com items vazio.");
                return NextResponse.json({ statuses: {} });
            }

            console.log(`[Transfeera] ▶ status_batch: processando ${items.length} item(s).`);
            console.log(`[Transfeera] Detalhe dos itens:`, JSON.stringify(items));

            const results: Record<string, string> = {};
            
            // Processar em chunks de 5 para evitar rate limit ou sobrecarga
            const chunkSize = 5;
            for (let i = 0; i < items.length; i += chunkSize) {
                const chunk = items.slice(i, i + chunkSize);
                
                await Promise.all(chunk.map(async (item) => {
                    if (!item.transfeera_id) {
                        results[item.id_interno] = "NAO_SUBMETIDO";
                        return;
                    }

                    try {
                        const res = await fetch(`${baseUrl}/transfer/${item.transfeera_id}`, {
                            headers: {
                                "Authorization": `Bearer ${token}`,
                                "User-Agent": UA_HEADER,
                            },
                        });

                        if (res.ok) {
                            const payload = await res.json();
                            const rawStatus = payload.status || "";
                            const normalized = normalizeTransfeeraStatus(rawStatus);
                            console.log(`✅ [${item.id_interno}] transfeera_id=${item.transfeera_id} status="${rawStatus}" → "${normalized}"`);
                            results[item.id_interno] = normalized;
                        } else {
                            const errBody = await res.text();
                            console.warn(`[Transfeera] GET /transfer/${item.transfeera_id} FALHOU (${res.status}): ${errBody}`);
                            results[item.id_interno] = "ERRO_CONSULTA";
                        }
                    } catch (e) {
                        console.error(`[Transfeera] Erro de rede para transfeera_id=${item.transfeera_id}:`, e);
                        results[item.id_interno] = "ERRO_REDE";
                    }
                }));
            }

            const matched = Object.values(results).filter(s => s !== "NAO_SUBMETIDO" && !s.startsWith("ERRO_")).length;
            console.log(`[Transfeera] Rastreio concluído: ${matched}/${items.length} IDs sincronizados.`);

            return NextResponse.json({ statuses: results });
        }

        // ═══════════════════════════════════════════════════════════════════════
        // ACTION: status_by_batch_id — Rastreio por Lote em vez de iteração
        // ═══════════════════════════════════════════════════════════════════════
        // ═══════════════════════════════════════════════════════════════════════
        // ACTION: status_by_batch_id — Bypass Global via Data
        // ═══════════════════════════════════════════════════════════════════════
        if (action === "status_by_batch_id") {
            const { batchId } = body;
            if (!batchId) {
                return NextResponse.json({ error: "batchId é obrigatório" }, { status: 400 });
            }

            // A Transfeera oculta itens da rota de Lotes quando criados via auto_close com itens embutidos.
            // Solução definitiva: Buscar na rota global de transferências filtrando pela data recente.
            const endDateObj = new Date();
            const initialDateObj = new Date();
            initialDateObj.setDate(endDateObj.getDate() - 15); // Puxa os últimos 15 dias de movimentação

            const initialDate = initialDateObj.toISOString().split('T')[0];
            const endDate = endDateObj.toISOString().split('T')[0];

            console.log(`[Transfeera] ▶ Contorno ativado: Buscando transferências globais entre ${initialDate} e ${endDate}...`);

            let allTransfers: any[] = [];
            let currentPage = 1;
            let hasMore = true;

            while (hasMore) {
                const url = `${baseUrl}/transfer?initialDate=${initialDate}&endDate=${endDate}&page=${currentPage}`;
                
                const tRes = await fetch(url, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "User-Agent": UA_HEADER,
                        Accept: "application/json",
                    },
                });

                if (!tRes.ok) {
                    console.error(`[Transfeera] ❌ Erro na requisição global (pág ${currentPage}):`, await tRes.text());
                    break;
                }

                const tPayload = await tRes.json();
                const list = Array.isArray(tPayload.data) ? tPayload.data : (Array.isArray(tPayload) ? tPayload : []);
                
                if (list.length > 0) {
                    allTransfers.push(...list);
                }

                // Verifica paginação usando o metadata oficial
                if (tPayload.metadata && tPayload.metadata.pagination) {
                    const { itemsPerPage, totalItems } = tPayload.metadata.pagination;
                    hasMore = currentPage < Math.ceil(totalItems / itemsPerPage);
                    currentPage++;
                } else {
                    hasMore = false;
                }
            }

            console.log(`[Transfeera] ✅ ${allTransfers.length} transferências globais recuperadas. O Frontend fará o match por ID.`);
            return NextResponse.json({ success: true, transfers: allTransfers });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });

    } catch (err: any) {
        console.error("Transfeera Proxy Error:", err);
        let status = 500;
        let message = err.message || "Erro interno no servidor";

        if (message === "Configuração de API ausente no servidor") {
            status = 400;
        } else if (message.startsWith("Transfeera Auth Error:")) {
            status = parseInt(message.split(":")[1]) || 500;
            message = `Falha na autenticação com a Transfeera (${status}). Verifique as credenciais do ambiente ${process.env.TRANSFEERA_ENV || 'produção'}.`;
        }

        return NextResponse.json({ error: message }, { status });
    }
}

// ─── GET Handler: Comprovantes ──────────────────────────────────────────────────
export async function GET(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(req.url);
        const action = url.searchParams.get("action");
        const idParam = url.searchParams.get("id");
        const transferId = url.searchParams.get("transfer_id"); // Novo: ID numérico da Transfeera

        if (action === "receipt" && (transferId || idParam)) {
            const token = await getTransfeeraToken();
            const baseUrl = getTransfeeraBaseUrl();

            let transferObj: any = null;

            // ── Caminho rápido: usar transfeera_transfer_id direto ──
            if (transferId) {
                console.log(`[Transfeera Receipt] GET /transfer/${transferId} (ID direto)`);
                const res = await fetch(`${baseUrl}/transfer/${transferId}`, {
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "User-Agent": UA_HEADER,
                    },
                });

                if (res.ok) {
                    transferObj = await res.json();
                    console.log(`✅ [Transfeera Receipt] Encontrado via ID direto`);
                } else {
                    console.warn(`[Transfeera Receipt] GET /transfer/${transferId} FALHOU (${res.status})`);
                }
            }

            // ── Caminho legado: varrer lotes por integration_id ──
            if (!transferObj && idParam) {
                console.log(`[Transfeera Receipt] Buscando por integration_id=${idParam} (legado)`);

                const batchRes = await fetch(`${baseUrl}/batch?per_page=50&page=1`, {
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "User-Agent": UA_HEADER,
                    },
                });

                if (batchRes.ok) {
                    const batchPayload = await batchRes.json();
                    const batches: any[] = Array.isArray(batchPayload) ? batchPayload : (batchPayload.data || []);

                    for (const batch of batches) {
                        const tRes = await fetch(`${baseUrl}/batch/${batch.id}/transfer?per_page=100`, {
                            headers: {
                                "Authorization": `Bearer ${token}`,
                                "User-Agent": UA_HEADER,
                            },
                        });
                        if (tRes.ok) {
                            const tPayload = await tRes.json();
                            const transfers: any[] = Array.isArray(tPayload) ? tPayload : (tPayload.data || []);
                            const found = transfers.find((t: any) => {
                                const apiId = (t.integration_id || t.id_integracao || "").toString().toLowerCase();
                                return apiId === idParam.toLowerCase();
                            });
                            if (found) {
                                transferObj = found;
                                break;
                            }
                        }
                    }
                }
            }

            if (!transferObj) {
                return NextResponse.json({ error: "Transferência não encontrada no gateway" }, { status: 404 });
            }

            const receiptUrl: string | undefined = transferObj.bank_receipt_url || transferObj.comprovante_url || transferObj.receipt_url;

            if (!receiptUrl) {
                return NextResponse.json({
                    error: `Comprovante indisponível. Status: ${transferObj.status || "desconhecido"}. Disponível apenas quando FINALIZADO.`
                }, { status: 404 });
            }

            console.log(`✅ [Transfeera Receipt] Proxy para: ${receiptUrl}`);

            const receiptRes = await fetch(receiptUrl);
            if (!receiptRes.ok) {
                return NextResponse.json({ error: "Link do comprovante expirado ou indisponível" }, { status: 502 });
            }

            const receiptBlob = await receiptRes.blob();
            return new NextResponse(receiptBlob, {
                status: 200,
                headers: {
                    "Content-Type": "application/pdf",
                    "Content-Disposition": `attachment; filename="comprovativo_${transferId || idParam}.pdf"`,
                },
            });
        }

        return NextResponse.json({ error: "Not found" }, { status: 404 });
    } catch (error: any) {
        console.error("Transfeera Receipt Error:", error);
        let status = 500;
        let message = error.message || "Erro ao buscar comprovativo";

        if (message === "Configuração de API ausente no servidor") {
            status = 400;
        } else if (message.startsWith("Transfeera Auth Error:")) {
            status = parseInt(message.split(":")[1]) || 500;
            message = `Erro de Autenticação Transfeera: ${status}`;
        }

        return NextResponse.json({ error: message }, { status });
    }
}
