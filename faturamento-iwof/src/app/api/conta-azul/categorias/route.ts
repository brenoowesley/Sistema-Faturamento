import { NextResponse } from "next/server";

export async function GET() {
    try {
        const clientId = process.env.CA_CLIENT_ID?.trim();
        const clientSecret = process.env.CA_CLIENT_SECRET?.trim();
        const refreshToken = process.env.CA_REFRESH_TOKEN?.trim();

        if (!clientId || !clientSecret || !refreshToken) {
            return NextResponse.json(
                { error: "Variáveis CA_CLIENT_ID, CA_CLIENT_SECRET ou CA_REFRESH_TOKEN ausentes no ambiente." },
                { status: 500 }
            );
        }

        // 1. Gera credenciais Basic Auth (Base64)
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

        // 2. Prepara o body para resgatar o Refresh Token
        const body = new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken
        });

        // 3. Obtém NOVO Access Token
        const tokenResponse = await fetch("https://auth.contaazul.com/oauth2/token", {
            method: "POST",
            headers: {
                "Authorization": `Basic ${credentials}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            return NextResponse.json(
                { error: "Falha ao renovar token de acesso (Refresh Token inválido ou expirado).", details: tokenData },
                { status: tokenResponse.status }
            );
        }

        const newAccessToken = tokenData.access_token;

        // 4. Utiliza o novo token para buscar a lista de categorias
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

        // 5. Retorna as categorias para a tela
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
