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
    
    // We assume production if there's no explicitly set SANDBOX flag
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
            console.error(`Transfeera Auth Error Details: Status ${response.status} - Body: ${errBody}`);
            throw new Error(`Transfeera Auth Error: ${response.status}`);
        }

        const data = await response.json();
        
        cachedTransfeeraToken = data.access_token;
        // The token usually lasts 3600 seconds, we cache it for 3500 seconds (almost 1 hour)
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
            console.warn("[Transfeera Proxy] Chamada bloqueada: Usuário não autenticado no Supabase.");
            return NextResponse.json({ error: "Sessão inválida ou o utilizador não está autenticado no sistema (Supabase)." }, { status: 401 });
        }

        const body = await req.json();
        const action = body.action;

        // Ensure token
        const token = await getTransfeeraToken();
        const baseUrl = getTransfeeraBaseUrl();

        if (action === "status_batch") {
            const ids: string[] = body.ids; // id_integracao (UUIDs)
            if (!ids || ids.length === 0) {
                return NextResponse.json({ statuses: {} });
            }

            const results: Record<string, string> = {};

            for (const id of ids) {
                try {
                    let transferObj: any = null;

                    // ─── Strategy 1: GET /transfer/{integration_id} ───────────────
                    // Endpoint oficial documentado: consulta transferência pelo ID de integração
                    console.log(`[Transfeera] Buscando ID=${id} → Strategy 1: GET /transfer/${id}`);
                    const res1 = await fetch(`${baseUrl}/transfer/${id}`, {
                        headers: {
                            "Authorization": `Bearer ${token}`,
                            "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                        }
                    });

                    console.log(`[Transfeera] Strategy 1 HTTP ${res1.status} para ID=${id}`);

                    if (res1.ok) {
                        const payload = await res1.json();
                        // Pode retornar objeto direto ou array
                        if (Array.isArray(payload)) {
                            transferObj = payload.find((t: any) => {
                                const apiId = (t.integration_id || t.id_integracao || "").toString().toLowerCase();
                                return apiId === id.toLowerCase();
                            }) ?? payload[0] ?? null;
                        } else if (payload && typeof payload === "object") {
                            transferObj = payload;
                        }
                        console.log(`[Transfeera] Strategy 1 payload:`, JSON.stringify(transferObj ?? payload));
                    } else {
                        const errBody = await res1.text();
                        console.warn(`[Transfeera] Strategy 1 FALHOU (${res1.status}): ${errBody}`);
                    }

                    // ─── Strategy 2 (fallback): listar lotes recentes → varrer transferências ──
                    if (!transferObj) {
                        console.log(`[Transfeera] Strategy 2: GET /batch?per_page=50`);
                        const res2 = await fetch(`${baseUrl}/batch?per_page=50`, {
                            headers: {
                                "Authorization": `Bearer ${token}`,
                                "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                            }
                        });

                        console.log(`[Transfeera] Strategy 2 HTTP ${res2.status}`);

                        if (res2.ok) {
                            const batchPayload = await res2.json();
                            const batches: any[] = Array.isArray(batchPayload) ? batchPayload : (batchPayload.data || []);
                            console.log(`[Transfeera] Strategy 2 retornou ${batches.length} lote(s)`);

                            // Para cada lote, busca as transferências e procura o ID de integração
                            for (const batch of batches) {
                                const batchId = batch.id;
                                const res3 = await fetch(`${baseUrl}/batch/${batchId}/transfer?per_page=100`, {
                                    headers: {
                                        "Authorization": `Bearer ${token}`,
                                        "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                                    }
                                });
                                if (res3.ok) {
                                    const tPayload = await res3.json();
                                    const transfers: any[] = Array.isArray(tPayload) ? tPayload : (tPayload.data || []);
                                    const found = transfers.find((t: any) => {
                                        const apiId = (t.integration_id || t.id_integracao || "").toString().toLowerCase();
                                        return apiId === id.toLowerCase();
                                    });
                                    if (found) {
                                        transferObj = found;
                                        console.log(`[Transfeera] Strategy 2 match no lote ${batchId}`);
                                        break;
                                    }
                                }
                            }
                        } else {
                            const errBody = await res2.text();
                            console.warn(`[Transfeera] Strategy 2 FALHOU (${res2.status}): ${errBody}`);
                        }
                    }

                    if (transferObj) {
                        const rawStatus = transferObj.status || transferObj.status_transferencia || "";
                        const normalizedStatus = normalizeTransfeeraStatus(rawStatus);
                        console.log(`✅ Match: ID=${id} | status_bruto="${rawStatus}" | normalizado="${normalizedStatus}"`);
                        results[id] = normalizedStatus;
                    } else {
                        console.log(`❌ Nenhum match para ID=${id} após todas as strategies.`);
                        results[id] = "NAO_SUBMETIDO";
                    }

                } catch (e) {
                    console.error(`[Transfeera] Erro de rede/exceção para ID=${id}:`, e);
                    results[id] = "ERRO_REDE";
                }
            }

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
        const idIntegracao = url.searchParams.get("id"); // The id_integracao (UUID)

        if (action === "receipt" && idIntegracao) {
            const token = await getTransfeeraToken();
            const baseUrl = getTransfeeraBaseUrl();

            // Busca a transferência pelo ID de integração via GET /transfer/{id}
            console.log(`[Transfeera Receipt] GET /transfer/${idIntegracao}`);
            let transferObj: any = null;

            const res1 = await fetch(`${baseUrl}/transfer/${idIntegracao}`, {
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                }
            });

            console.log(`[Transfeera Receipt] HTTP ${res1.status}`);

            if (res1.ok) {
                const payload = await res1.json();
                transferObj = Array.isArray(payload) ? payload[0] : payload;
                console.log(`[Transfeera Receipt] Payload:`, JSON.stringify(transferObj));
            }

            if (!transferObj) {
                return NextResponse.json({ error: "Transferência não encontrada no gateway" }, { status: 404 });
            }

            // A Transfeera disponibiliza o link do comprovante em bank_receipt_url no objeto
            const receiptUrl: string | undefined = transferObj.bank_receipt_url || transferObj.comprovante_url || transferObj.receipt_url;

            if (!receiptUrl) {
                console.warn(`[Transfeera Receipt] bank_receipt_url ausente. Status: ${transferObj.status}`);
                return NextResponse.json({ 
                    error: `Comprovante indisponível. Status: ${transferObj.status || "desconhecido"}. Disponível apenas quando FINALIZADO.` 
                }, { status: 404 });
            }

            console.log(`✅ [Transfeera Receipt] Fazendo proxy para: ${receiptUrl}`);

            // Faz proxy do PDF para o cliente (evita CORS e não expõe o link temporário)
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
