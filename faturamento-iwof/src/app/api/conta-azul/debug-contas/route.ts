import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

const API_BASE = "https://api-v2.contaazul.com";

async function getValidToken() {
    const clientId = process.env.CA_CLIENT_ID?.trim();
    const clientSecret = process.env.CA_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
        throw new Error("Credenciais do Conta Azul ausentes.");
    }

    const { data: tokenData, error: tokenErr } = await supabaseAdmin
        .from('conta_azul_tokens')
        .select('refresh_token')
        .eq('id', 'padrao')
        .single();

    if (tokenErr || !tokenData?.refresh_token) {
        throw new Error("Refresh token não encontrado.");
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokenData.refresh_token,
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
        throw new Error(`Falha ao renovar token: ${data.error_description || data.error}`);
    }

    if (data.refresh_token) {
        await supabaseAdmin
            .from('conta_azul_tokens')
            .update({ refresh_token: data.refresh_token, updated_at: new Date().toISOString() })
            .eq('id', 'padrao');
    }

    return data.access_token;
}

/**
 * GET /api/conta-azul/debug-contas
 * Lista todas as contas financeiras do Conta Azul com seus tipos e UUIDs.
 * Uso: descobrir qual conta é do tipo COBRANCAS_CONTA_AZUL para emissão de boletos.
 */
export async function GET() {
    try {
        const accessToken = await getValidToken();

        const params = new URLSearchParams({
            pagina: "1",
            tamanho_pagina: "1000",
            apenas_ativo: "true"
        });

        const response = await fetch(`${API_BASE}/v1/conta-financeira?${params}`, {
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            return NextResponse.json({ error: `API Error ${response.status}: ${errText}` }, { status: response.status });
        }

        const data = await response.json();
        const contas = (data.itens || []).map((c: any) => ({
            id: c.id,
            nome: c.nome,
            tipo: c.tipo,
            banco: c.banco,
            agencia: c.agencia,
            numero: c.numero,
            conta_padrao: c.conta_padrao,
            possui_config_boleto: c.possui_config_boleto_bancario,
            ativo: c.ativo
        }));

        // Destaca contas que suportam cobrança
        const contasCobranca = contas.filter((c: any) => c.tipo === "COBRANCAS_CONTA_AZUL");
        const contasBoleto = contas.filter((c: any) => c.possui_config_boleto === true);

        return NextResponse.json({
            total: contas.length,
            contas_cobranca_conta_azul: contasCobranca,
            contas_com_config_boleto: contasBoleto,
            todas_contas: contas
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
