import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

export async function GET() {
    try {
        const clientId = process.env.CA_CLIENT_ID?.trim();
        const clientSecret = process.env.CA_CLIENT_SECRET?.trim();

        if (!clientId || !clientSecret) {
            return NextResponse.json(
                { error: "Variáveis CA_CLIENT_ID ou CA_CLIENT_SECRET ausentes no ambiente." },
                { status: 500 }
            );
        }

        // 1. Busca o refresh_token no Supabase (fonte única de verdade, igual ao exportar-lote)
        const { data: tokenData, error: tokenErr } = await supabaseAdmin
            .from("conta_azul_tokens")
            .select("refresh_token")
            .eq("id", "padrao")
            .single();

        if (tokenErr || !tokenData?.refresh_token) {
            return NextResponse.json(
                {
                    error: "Refresh token não encontrado no banco de dados. Realize a autenticação OAuth2 primeiro.",
                    details: tokenErr?.message
                },
                { status: 401 }
            );
        }

        // 2. Gera credenciais Basic Auth (Base64)
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

        // 3. Prepara o body para resgatar o Access Token via Refresh Token
        const body = new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tokenData.refresh_token,
            client_id: clientId
        });

        // 4. Obtém NOVO Access Token via auth.contaazul.com (Cognito)
        const tokenResponse = await fetch("https://auth.contaazul.com/oauth2/token", {
            method: "POST",
            headers: {
                "Authorization": `Basic ${credentials}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        });

        const newTokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            return NextResponse.json(
                { error: "Falha ao renovar token de acesso (Refresh Token inválido ou expirado).", details: newTokenData },
                { status: tokenResponse.status }
            );
        }

        // 5. Persiste o novo refresh_token no Supabase (Cognito tokens são single-use)
        if (newTokenData.refresh_token) {
            const { error: updateErr } = await supabaseAdmin
                .from("conta_azul_tokens")
                .update({
                    refresh_token: newTokenData.refresh_token,
                    updated_at: new Date().toISOString()
                })
                .eq("id", "padrao");

            if (updateErr) {
                console.error("🚨 CRÍTICO: Falha ao salvar novo refresh_token no banco após /categorias.", updateErr);
            }
        }

        const newAccessToken = newTokenData.access_token;

        // 6. Utiliza o novo token para buscar a lista de categorias
        const categoriesResponse = await fetch("https://api.contaazul.com/v1/categories", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${newAccessToken}`
            }
        });

        const categoriesData = await categoriesResponse.json();

        if (!categoriesResponse.ok) {
            return NextResponse.json(
                { error: "Token renovado, mas falha ao buscar categorias API v1", details: categoriesData },
                { status: categoriesResponse.status }
            );
        }

        // 7. Retorna as categorias para a tela
        return NextResponse.json({
            categorias: categoriesData
        });

    } catch (error: any) {
        console.error("Erro interno ao buscar categorias:", error);
        return NextResponse.json(
            { error: "Erro interno do servidor", message: error.message },
            { status: 500 }
        );
    }
}
