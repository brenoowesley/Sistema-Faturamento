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

            // Normaliza o status retornado pela Transfeera para valores conhecidos pelo frontend
            function normalizeTransfeeraStatus(raw: string): string {
                if (!raw) return "NAO_SUBMETIDO";
                const s = raw.toUpperCase().trim();
                // Mapeamento de possíveis variações da API
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
                return map[s] ?? raw; // devolve o original se não mapear, para ficar visível no badge
            }

            const results: Record<string, string> = {};

            for (const id of ids) {
                try {
                    let match = null;

                    // Strategy 1: PT endpoint com per_page=100 para evitar truncamento por paginação
                    const qsPT = new URLSearchParams({ id_integracao: id, per_page: "100" }).toString();
                    console.log(`[Transfeera] Buscando ID=${id} → Strategy 1 (PT): /transferencias?${qsPT}`);
                    const resPT = await fetch(`${baseUrl}/transferencias?${qsPT}`, {
                        headers: {
                            "Authorization": `Bearer ${token}`,
                            "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                        }
                    });

                    console.log(`[Transfeera] Strategy 1 HTTP ${resPT.status} para ID=${id}`);

                    if (resPT.ok) {
                        const payload = await resPT.json();
                        const transfers = Array.isArray(payload) ? payload : (payload.data || []);
                        console.log(`[Transfeera] Strategy 1 retornou ${transfers.length} item(s). Sample:`, JSON.stringify(transfers[0] ?? null));

                        match = transfers.find((t: any) => {
                            const apiId = (t.integration_id || t.id_integracao || "").toString().toLowerCase();
                            return apiId === id.toLowerCase();
                        });
                    } else {
                        const errBody = await resPT.text();
                        console.warn(`[Transfeera] Strategy 1 FALHOU (${resPT.status}): ${errBody}`);
                    }

                    // Strategy 2: EN endpoint com per_page=100
                    if (!match) {
                        const qsEN = new URLSearchParams({ integration_id: id, per_page: "100" }).toString();
                        console.log(`[Transfeera] Buscando ID=${id} → Strategy 2 (EN): /transfers?${qsEN}`);
                        const resEN = await fetch(`${baseUrl}/transfers?${qsEN}`, {
                            headers: {
                                "Authorization": `Bearer ${token}`,
                                "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                            }
                        });

                        console.log(`[Transfeera] Strategy 2 HTTP ${resEN.status} para ID=${id}`);

                        if (resEN.ok) {
                            const payload = await resEN.json();
                            const transfers = Array.isArray(payload) ? payload : (payload.data || []);
                            console.log(`[Transfeera] Strategy 2 retornou ${transfers.length} item(s). Sample:`, JSON.stringify(transfers[0] ?? null));

                            match = transfers.find((t: any) => {
                                const apiId = (t.integration_id || t.id_integracao || "").toString().toLowerCase();
                                return apiId === id.toLowerCase();
                            });
                        } else {
                            const errBody = await resEN.text();
                            console.warn(`[Transfeera] Strategy 2 FALHOU (${resEN.status}): ${errBody}`);
                        }
                    }

                    if (match) {
                        const normalizedStatus = normalizeTransfeeraStatus(match.status);
                        console.log(`✅ Match encontrado: ID=${id} | status_bruto="${match.status}" | normalizado="${normalizedStatus}"`);
                        results[id] = normalizedStatus;
                    } else {
                        console.log(`❌ Nenhum match para ID=${id} após ambas as strategies.`);
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

// GET is used for the receipt downloads
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

            // First we must find the official Transfeera internal ID based on our id_integracao
            // Try Strategy 1 (PT)
            const qsPT = new URLSearchParams({ id_integracao: idIntegracao }).toString();
            let listRes = await fetch(`${baseUrl}/transferencias?${qsPT}`, {
                headers: { 
                    "Authorization": `Bearer ${token}`,
                    "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                }
            });

            let match = null;
            if (listRes.ok) {
                const payload = await listRes.json();
                const transfers = Array.isArray(payload) ? payload : (payload.data || []);
                
                // BUSCA RESILIENTE:
                match = transfers.find((t: any) => {
                    const apiId = (t.integration_id || t.id_integracao || "").toString().toLowerCase();
                    return apiId === idIntegracao.toLowerCase();
                });
            }

            // Try Strategy 2 (EN)
            if (!match) {
                const qsEN = new URLSearchParams({ integration_id: idIntegracao }).toString();
                const listResEN = await fetch(`${baseUrl}/transfers?${qsEN}`, {
                    headers: { 
                        "Authorization": `Bearer ${token}`,
                        "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                    }
                });
                if (listResEN.ok) {
                    const payload = await listResEN.json();
                    const transfers = Array.isArray(payload) ? payload : (payload.data || []);
                    
                    // BUSCA RESILIENTE:
                    match = transfers.find((t: any) => {
                        const apiId = (t.integration_id || t.id_integracao || "").toString().toLowerCase();
                        return apiId === idIntegracao.toLowerCase();
                    });
                }
            }

            if (match) {
                console.log(`✅ Match (Receipt) encontrado: ${idIntegracao} -> ID Transfeera: ${match.id}`);
            } else {
                console.log(`❌ Match (Receipt) falhou para ID: ${idIntegracao}`);
            }

            if (!match || !match.id) {
                return NextResponse.json({ error: "Transferência não encontrada no gateway após múltiplas tentativas" }, { status: 404 });
            }

            // Now get the receipt using Transfeera's internal transfer ID
            const transfeeraId = match.id;
            
            // Try Receipt Strategy 1 (PT)
            let receiptRes = await fetch(`${baseUrl}/transferencias/${transfeeraId}/comprovante`, {
                headers: { 
                    "Authorization": `Bearer ${token}`,
                    "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                }
            });

            // Try Receipt Strategy 2 (EN)
            if (!receiptRes.ok) {
                receiptRes = await fetch(`${baseUrl}/transfers/${transfeeraId}/receipt`, {
                    headers: { 
                        "Authorization": `Bearer ${token}`,
                        "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                    }
                });
            }

            if (!receiptRes.ok) {
                return NextResponse.json({ error: "Comprovativo não disponível em nenhum endpoint do provedor" }, { status: 502 });
            }


            // Provide the binary stream straight back to the client
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
