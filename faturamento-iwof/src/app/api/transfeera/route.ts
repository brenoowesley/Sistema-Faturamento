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
        console.error("Missing Transfeera credentials in environment variables.");
        throw new Error("Transfeera Auth configuration is missing.");
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
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

            // Since Transfeera API allows querying transfers, we map id_integracao.
            // Documentation usually allows array filters like ?id_integracao=uuid1&id_integracao=uuid2
            // However, depending on the exact implementation, we might need a general fetch.
            // Here we assume standard REST filters or fetching individually. To be safe, we query. 
            // In a highly optimized system, we'd batch. Let's send requests concurrently.
            // Transfeera provides GET /transferencias
            
            // To prevent hammering the API or URL length limits, we fetch them individually or in chunks.
            const results: Record<string, string> = {};
            
            // Chunked fetching for better API citizenship
            for (const id of ids) {
                 try {
                    // Strategy 1: Search by id_integracao (Official Portuguese V2)
                    let qsPT = new URLSearchParams({ id_integracao: id }).toString();
                    console.log(`[Transfeera] Procurando ID ${id} - Strategy 1 (PT): /transferencias?${qsPT}`);
                    let resPT = await fetch(`${baseUrl}/transferencias?${qsPT}`, {
                        headers: { 
                            "Authorization": `Bearer ${token}`,
                            "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                        }
                    });
                    
                    let match = null;

                    if (resPT.ok) {
                        const payload = await resPT.json();
                        const transfers = Array.isArray(payload) ? payload : payload.data || [];
                        // Resilient match: dual key check and lowercase normalization
                        match = transfers.find((t: any) => {
                            const transfeeraId = (t.id_integracao || t.integration_id || "").toString().toLowerCase();
                            return transfeeraId === id.toLowerCase();
                        });
                    }

                    // Strategy 2: Search by integration_id (Official English V2)
                    if (!match) {
                        let qsEN = new URLSearchParams({ integration_id: id }).toString();
                        console.log(`[Transfeera] Procurando ID ${id} - Strategy 2 (EN): /transfers?${qsEN}`);
                        const resEN = await fetch(`${baseUrl}/transfers?${qsEN}`, {
                            headers: { 
                                "Authorization": `Bearer ${token}`,
                                "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
                            }
                        });
                        if (resEN.ok) {
                            const payload = await resEN.json();
                            const transfers = Array.isArray(payload) ? payload : payload.data || [];
                            // Resilient match: dual key check and lowercase normalization
                            match = transfers.find((t: any) => {
                                const transfeeraId = (t.integration_id || t.id_integracao || "").toString().toLowerCase();
                                return transfeeraId === id.toLowerCase();
                            });
                        }
                    }

                    if (match) {
                        console.log(`[Transfeera] ID ${id} encontrado com status: ${match.status}`);
                        results[id] = match.status;
                    } else {
                        console.log(`[Transfeera] ID ${id} não encontrado em NENHUMA estratégia.`);
                        results[id] = "NAO_SUBMETIDO";
                    }

                 } catch (e) {
                     console.error(`[Transfeera API] Erro de rede/exceção para ID ${id}:`, e);
                     results[id] = "ERRO_REDE";
                 }

            }

            return NextResponse.json({ statuses: results });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });

    } catch (err: any) {
        console.error("Transfeera Proxy Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
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
                const transfers = Array.isArray(payload) ? payload : payload.data || [];
                // Resilient match: dual key check and lowercase normalization
                match = transfers.find((t: any) => {
                    const transfeeraId = (t.id_integracao || t.integration_id || "").toString().toLowerCase();
                    return transfeeraId === idIntegracao.toLowerCase();
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
                    const transfers = Array.isArray(payload) ? payload : payload.data || [];
                    // Resilient match: dual key check and lowercase normalization
                    match = transfers.find((t: any) => {
                        const transfeeraId = (t.integration_id || t.id_integracao || "").toString().toLowerCase();
                        return transfeeraId === idIntegracao.toLowerCase();
                    });
                }
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
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
