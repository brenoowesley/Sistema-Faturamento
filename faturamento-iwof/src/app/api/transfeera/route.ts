import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Cache for the Bearer token to avoid authenticating on every request
let cachedTransfeeraToken: string | null = null;
let tokenExpiryTime: number | null = null;

// Auth logic inside the Next.js API
async function getTransfeeraToken() {
    if (cachedTransfeeraToken && tokenExpiryTime && Date.now() < tokenExpiryTime) {
        return cachedTransfeeraToken;
    }

    const clientId = process.env.TRANSFEERA_CLIENT_ID;
    const clientSecret = process.env.TRANSFEERA_CLIENT_SECRET;
    
    const baseUrl = process.env.TRANSFEERA_ENV === "sandbox" 
        ? "https://login-api-sandbox.transfeera.com" 
        : "https://login-api.transfeera.com";

    if (!clientId || !clientSecret) {
        console.error("Transfeera Error: Missing TRANSFEERA_CLIENT_ID or TRANSFEERA_CLIENT_SECRET");
        throw new Error("Configuração de API ausente no servidor");
    }

    try {
        const response = await fetch(`${baseUrl}/authorization`, {
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
    } catch (e) {
        console.error("Transfeera token fetch failure:", e);
        throw e;
    }
}

function getTransfeeraBaseUrl() {
    return process.env.TRANSFEERA_ENV === "sandbox"
        ? "https://api-sandbox.transfeera.com"
        : "https://api.transfeera.com";
}

// Normaliza o status retornado pela Transfeera para valores conhecidos pelo frontend
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

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            console.warn("[Transfeera Proxy] Chamada bloqueada: Usuário não autenticado.");
            return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
        }

        const body = await req.json();
        const action = body.action;

        const token = await getTransfeeraToken();
        const baseUrl = getTransfeeraBaseUrl();
        const env = process.env.TRANSFEERA_ENV || "production";

        if (action === "status_batch") {
            const ids: string[] = body.ids;
            if (!ids || ids.length === 0) {
                return NextResponse.json({ statuses: {} });
            }

            console.log(`[Transfeera] ▶ status_batch: ${ids.length} ID(s) | Ambiente: ${env} | Base URL: ${baseUrl}`);

            // ─── Passo 1: Carregar todos os lotes disponíveis na conta ────────────────
            // GET /transfer/{id} requer ID numérico interno da Transfeera, não nosso UUID.
            // A única forma de buscar por integration_id é listar lotes e varrer transferências.
            const allBatches: any[] = [];
            let batchPage = 1;
            let hasMoreBatches = true;

            while (hasMoreBatches && batchPage <= 10) { // máximo 10 páginas (500 lotes)
                const batchRes = await fetch(`${baseUrl}/batch?per_page=50&page=${batchPage}`, {
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                    }
                });

                if (!batchRes.ok) {
                    const errBody = await batchRes.text();
                    console.warn(`[Transfeera] GET /batch page=${batchPage} FALHOU (${batchRes.status}): ${errBody}`);
                    break;
                }

                const batchPayload = await batchRes.json();
                const pageBatches: any[] = Array.isArray(batchPayload) ? batchPayload : (batchPayload.data || []);
                console.log(`[Transfeera] GET /batch page=${batchPage} → ${pageBatches.length} lote(s)`);

                allBatches.push(...pageBatches);

                // Se retornou menos de 50, não há mais páginas
                if (pageBatches.length < 50) {
                    hasMoreBatches = false;
                } else {
                    batchPage++;
                }
            }

            console.log(`[Transfeera] Total de lotes carregados: ${allBatches.length}`);

            if (allBatches.length === 0) {
                console.warn(`[Transfeera] ⚠️ ZERO lotes encontrados no ambiente "${env}". Verifique se TRANSFEERA_ENV está correto no Vercel e se os pagamentos foram submetidos neste mesmo ambiente.`);
                const emptyResults: Record<string, string> = {};
                for (const id of ids) emptyResults[id] = "NAO_SUBMETIDO";
                return NextResponse.json({ statuses: emptyResults });
            }

            // ─── Passo 2: Para cada lote, buscar transferências e indexar por integration_id ──
            // Construir um mapa: integration_id (lowercase) → objeto da transferência
            const transferMap: Record<string, any> = {};

            for (const batch of allBatches) {
                const batchId = batch.id;
                const transferRes = await fetch(`${baseUrl}/batch/${batchId}/transfer?per_page=100`, {
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                    }
                });

                if (!transferRes.ok) {
                    console.warn(`[Transfeera] GET /batch/${batchId}/transfer FALHOU (${transferRes.status})`);
                    continue;
                }

                const tPayload = await transferRes.json();
                const transfers: any[] = Array.isArray(tPayload) ? tPayload : (tPayload.data || []);

                for (const t of transfers) {
                    const integId = (t.integration_id || t.id_integracao || "").toString().toLowerCase();
                    if (integId) {
                        transferMap[integId] = t;
                    }
                }
            }

            console.log(`[Transfeera] Mapa de transferências construído com ${Object.keys(transferMap).length} entradas`);
            if (Object.keys(transferMap).length > 0) {
                const sampleKey = Object.keys(transferMap)[0];
                console.log(`[Transfeera] Sample da primeira transferência encontrada:`, JSON.stringify(transferMap[sampleKey]));
            }

            // ─── Passo 3: Resolver cada ID solicitado ─────────────────────────────────
            const results: Record<string, string> = {};

            for (const id of ids) {
                const found = transferMap[id.toLowerCase()];
                if (found) {
                    const rawStatus = found.status || found.status_transferencia || "";
                    const normalizedStatus = normalizeTransfeeraStatus(rawStatus);
                    console.log(`✅ ID=${id} | status_bruto="${rawStatus}" | normalizado="${normalizedStatus}"`);
                    results[id] = normalizedStatus;
                } else {
                    results[id] = "NAO_SUBMETIDO";
                }
            }

            const matched = Object.values(results).filter(s => s !== "NAO_SUBMETIDO").length;
            console.log(`[Transfeera] Resultado: ${matched}/${ids.length} IDs encontrados`);

            return NextResponse.json({ statuses: results });
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

// GET is used for the receipt downloads — usa bank_receipt_url do objeto de transferência
export async function GET(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(req.url);
        const action = url.searchParams.get("action");
        const idIntegracao = url.searchParams.get("id");

        if (action === "receipt" && idIntegracao) {
            const token = await getTransfeeraToken();
            const baseUrl = getTransfeeraBaseUrl();
            const env = process.env.TRANSFEERA_ENV || "production";

            console.log(`[Transfeera Receipt] Buscando comprovante para ID=${idIntegracao} | Ambiente: ${env}`);

            // Varrer lotes para encontrar a transferência pelo integration_id
            let transferObj: any = null;

            const batchRes = await fetch(`${baseUrl}/batch?per_page=50&page=1`, {
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                }
            });

            if (batchRes.ok) {
                const batchPayload = await batchRes.json();
                const batches: any[] = Array.isArray(batchPayload) ? batchPayload : (batchPayload.data || []);

                for (const batch of batches) {
                    const tRes = await fetch(`${baseUrl}/batch/${batch.id}/transfer?per_page=100`, {
                        headers: {
                            "Authorization": `Bearer ${token}`,
                            "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                        }
                    });
                    if (tRes.ok) {
                        const tPayload = await tRes.json();
                        const transfers: any[] = Array.isArray(tPayload) ? tPayload : (tPayload.data || []);
                        const found = transfers.find((t: any) => {
                            const apiId = (t.integration_id || t.id_integracao || "").toString().toLowerCase();
                            return apiId === idIntegracao.toLowerCase();
                        });
                        if (found) {
                            transferObj = found;
                            console.log(`✅ [Transfeera Receipt] Transferência encontrada no lote ${batch.id}`);
                            break;
                        }
                    }
                }
            }

            if (!transferObj) {
                console.warn(`[Transfeera Receipt] Transferência não encontrada para ID=${idIntegracao}`);
                return NextResponse.json({ error: "Transferência não encontrada no gateway" }, { status: 404 });
            }

            // A Transfeera disponibiliza o link do comprovante em bank_receipt_url no objeto
            const receiptUrl: string | undefined = transferObj.bank_receipt_url || transferObj.comprovante_url || transferObj.receipt_url;

            if (!receiptUrl) {
                console.warn(`[Transfeera Receipt] bank_receipt_url ausente. Status atual: ${transferObj.status}`);
                return NextResponse.json({ 
                    error: `Comprovante indisponível. Status: ${transferObj.status || "desconhecido"}. O comprovante só fica disponível quando o pagamento está FINALIZADO.` 
                }, { status: 404 });
            }

            console.log(`✅ [Transfeera Receipt] Fazendo proxy para: ${receiptUrl}`);

            const receiptRes = await fetch(receiptUrl);
            if (!receiptRes.ok) {
                return NextResponse.json({ error: "Link do comprovante expirado ou indisponível" }, { status: 502 });
            }

            const receiptBlob = await receiptRes.blob();
            return new NextResponse(receiptBlob, {
                status: 200,
                headers: {
                    "Content-Type": "application/pdf",
                    "Content-Disposition": `attachment; filename="comprovativo_${idIntegracao}.pdf"`
                }
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
