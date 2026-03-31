import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    try {
        const code = request.nextUrl.searchParams.get("code");

        if (!code) {
            return NextResponse.json(
                { error: "Parâmetro 'code' não encontrado na URL." },
                { status: 400 }
            );
        }

        const clientId = process.env.CA_CLIENT_ID;
        const clientSecret = process.env.CA_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            return NextResponse.json(
                { error: "As variáveis CA_CLIENT_ID ou CA_CLIENT_SECRET não estão configuradas corretamente no ambiente." },
                { status: 500 }
            );
        }

        // 1. Solicita os Tokens usando o Authorization Code nativamente
        const base64Auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

        const params = new URLSearchParams({
            grant_type: "authorization_code",
            redirect_uri: "https://faturamento-iwof.vercel.app/api/conta-azul/callback",
            code: code,
        });

        const tokenResponse = await fetch("https://api.contaazul.com/oauth2/token", {
            method: "POST",
            headers: {
                "Authorization": `Basic ${base64Auth}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
            cache: "no-store"
        });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            return NextResponse.json(
                { error: "Falha na extração de Tokens Conta Azul", details: tokenData },
                { status: tokenResponse.status }
            );
        }

        const accessToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token;

        // 2. Comprova a eficácia do Token testando o resgate de Bancos via GET
        const banksResponse = await fetch("https://api.contaazul.com/v1/banks", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${accessToken}`
            },
            cache: "no-store"
        });

        const banksData = await banksResponse.json();

        if (!banksResponse.ok) {
            return NextResponse.json(
                {
                    error: "Tokens resgatados, mas erro ao interceptar os Bancos",
                    tokens: { access_token: accessToken, refresh_token: refreshToken },
                    details: banksData
                },
                { status: banksResponse.status }
            );
        }

        // 3. Exibe a tela de Sucesso e os Logs Vitais
        return NextResponse.json({
            message: "Integração validada com sucesso! Conexão OAuth2 testada e aprovada.",
            tokens: {
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_in: tokenData.expires_in,
            },
            banks: banksData
        });

    } catch (error: any) {
        console.error("Erro no callback do Conta Azul:", error);
        return NextResponse.json(
            { error: "Erro interno de Servidor na rota OAuth2", detailed_message: error.message },
            { status: 500 }
        );
    }
}
