import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

export async function POST(req: NextRequest) {
    try {
        const { loteId } = await req.json();

        if (!loteId) {
            return NextResponse.json({ error: "loteId is required" }, { status: 400 });
        }

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        // 1. Fetch consolidated data with joins
        const { data: records, error } = await supabase
            .from("faturamento_consolidados")
            .select(`
                *,
                clientes (
                    nome_fantasia,
                    razao_social,
                    cnpj,
                    estado,
                    ciclos_faturamento (nome)
                )
            `)
            .eq("lote_id", loteId);

        if (error) throw error;
        if (!records || records.length === 0) {
            return NextResponse.json({ error: "No consolidated records found for this lote" }, { status: 404 });
        }

        // 2. Google Sheets Authentication
        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
            },
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });

        const sheets = google.sheets({ version: "v4", auth });
        const spreadsheetId = "1OTBvpBHD86eTTiZwJDABWeKaMAVTZ5M4Hmg4tiXlFIs";

        // 3. Clear existing data in "Teste" (preserving header)
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: "Teste!A2:I",
        });

        // 4. Format data for Sheets
        const values = records.map((record) => {
            const client = record.clientes as any;
            return [
                client.nome_fantasia || client.razao_social, // [0] LOJA
                client.cnpj,                                // [1] CNPJ
                client.estado || "",                        // [2] ESTADO
                Number(record.valor_boleto_final),          // [3] BOLETO
                Number(record.valor_nf_emitida),            // [4] NF
                Number(record.valor_nc_final),              // [5] NC
                record.numero_nf || "0",                    // [6] Nº NF
                Number(record.descontos),                   // [7] DESCONTO
                client.ciclos_faturamento?.nome || "GERAL", // [8] Faturamento
            ];
        });

        // 5. Update Spreadsheet
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: "Teste!A2",
            valueInputOption: "RAW",
            requestBody: { values },
        });

        // 6. Trigger Webhooks (Cloud Functions)
        try {
            // NC Mestre
            await fetch("https://us-central1-faturamentoiwof.cloudfunctions.net/gerar-nc-mestre", { method: "GET" });

            // Note: If there's a specific faturas webhook, add it here too.
            // await fetch("URL_DAS_FATURAS", { method: "GET" });
        } catch (webhookErr) {
            console.warn("Webhook warning (non-blocking):", webhookErr);
        }

        // 7. Update Lote status to CONCLUÍDO
        const { error: updateErr } = await supabase
            .from("faturamentos_lote")
            .update({ status: "CONCLUÍDO" })
            .eq("id", loteId);

        if (updateErr) throw updateErr;

        return NextResponse.json({
            success: true,
            message: "Planilha preenchida e robôs disparados com sucesso."
        });

    } catch (err: any) {
        console.error("Legacy Dispatch Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
