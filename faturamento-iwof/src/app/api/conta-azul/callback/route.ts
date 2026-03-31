import { NextResponse } from "next/server";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const code = searchParams.get("code");

        if (!code) {
            return NextResponse.json({ error: "Nenhum código fornecido." }, { status: 400 });
        }

        const clientId = process.env.CA_CLIENT_ID?.trim();
        const clientSecret = process.env.CA_CLIENT_SECRET?.trim();

        if (!clientId || !clientSecret) {
            return NextResponse.json({ error: "Chaves ausentes na Vercel." }, { status: 500 });
        }

        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

        const body = new URLSearchParams({
            grant_type: "authorization_code",
            redirect_uri: "https://faturamento-iwof.vercel.app/api/conta-azul/callback",
            code: code,
            client_id: clientId // Exigência do novo servidor Cognito
        });

        // BATER NA PORTA NOVA (auth.contaazul.com)
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
            return NextResponse.json({ error: "Falha Nova API", details: tokenData }, { status: tokenResponse.status });
        }

        // Buscar bancos na API V2
        const banksResponse = await fetch("https://api-v2.contaazul.com/v1/banks", {
            method: "GET",
            headers: { "Authorization": `Bearer ${tokenData.access_token}` },
        });

        // Se o /banks não existir na V2, tentamos na V1 silenciosamente
        let banksData = await banksResponse.json().catch(() => ({ aviso: "Rota de bancos não encontrada na v2" }));

        return NextResponse.json({
            SUCESSO: "Autenticação Cognito realizada!",
            tokens: {
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
            },
            bancos: banksData,
        });

    } catch (error: any) {
        return NextResponse.json({ error: "Erro interno", message: error.message }, { status: 500 });
    }
}