import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

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

function getCategoriaEnv(categoriaString: string): string {
    const str = (categoriaString || "").toUpperCase();
    if (str.includes("SEMANAL")) return process.env.CA_CATEGORY_SEMANAL || "";
    if (str.includes("QUINZENAL")) return process.env.CA_CATEGORY_QUINZENAL || "";
    if (str.includes("MENSAL")) return process.env.CA_CATEGORY_MENSAL || "";
    return process.env.CONTA_AZUL_CATEGORY_ID || "1"; // Fallback caso não ache
}

export async function POST(req: Request) {
    try {
        const rows = await req.json();

        if (!Array.isArray(rows)) {
            return NextResponse.json({ error: "O payload deve ser um array." }, { status: 400 });
        }

        // 1. O Motor de Renovação - Busca Token Fresco
        let accessToken: string;
        try {
            accessToken = await getValidToken();
        } catch (tokenErr: any) {
            console.error("Erro na autenticação:", tokenErr);
            return NextResponse.json({ error: tokenErr.message }, { status: 401 });
        }

        const bankAccountId = process.env.CONTA_AZUL_BANK_ACCOUNT_ID;
        if (!bankAccountId) {
            return NextResponse.json({ error: "CONTA_AZUL_BANK_ACCOUNT_ID não está configurado." }, { status: 500 });
        }

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        // 2. Integração Principal
        for (const item of rows) {
            if (!item.valor || item.valor <= 0) {
                continue;
            }

            // Define a categoria baseada na string "FATURAMENTO (MENSAL)" originada no frontend
            const categoryId = getCategoriaEnv(item.categoria);

            if (!categoryId) {
                errorCount++;
                errors.push({ id: item.id, cliente: item.cliente, erro: `A Categoria Financeira para o ciclo (${item.categoria}) não está configurada no .env.local` });
                continue;
            }

            // O formato /v1/sales é tipicamente usado para emitir faturamento
            // A API de Vendas (Sales/Invoices) aceita esses campos. Se for lançamento via Financial, o endpoint seria outro e body diferente. 
            // O conta azul geralmente usa /v1/sales para vendas e financeiro atrelado
            const payload = {
                date: new Date(item.dataCompetencia).toISOString(),
                expected_payment_date: new Date(item.dataVencimento).toISOString(),
                value: item.valor,
                customer_id: item.cnpj || item.cliente, 
                category_id: categoryId,
                bank_account_id: bankAccountId,
                seller_id: null,
                notes: item.descricao || "Faturamento"
            };

            try {
                const response = await fetch("https://api.contaazul.com/v1/sales", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${accessToken}`
                    },
                    body: JSON.stringify(payload)
                });
                
                // Tratar o Payload Response se negativo
                if (!response.ok) {
                    const errObj = await response.json().catch(() => ({}));
                    throw new Error(`Erro API (${response.status}): ${errObj.message || response.statusText}`);
                }

                // Considerar um delay para respeitar Rate Limits da API
                await new Promise(resolve => setTimeout(resolve, 150));

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
