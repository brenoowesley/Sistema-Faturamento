import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { pubsub, TOPICS } from "@/lib/google/pubsub";

export async function POST(req: NextRequest) {
    try {
        const { loteId } = await req.json();

        if (!loteId) {
            return NextResponse.json({ error: "loteId is required" }, { status: 400 });
        }

        // Initialize Supabase Admin for backend operations (if needed, but here standard client works if service role)
        // For simplicity, we assume environment variables for service role are set if needed, 
        // or we use the request's auth. Here we use service role for reliable batch processing.
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Fetch consolidated data with joins
        const { data: records, error } = await supabase
            .from("faturamento_consolidados")
            .select(`
                *,
                clientes (
                    nome_fantasia,
                    razao_social,
                    cnpj,
                    ciclos_faturamento (nome)
                )
            `)
            .eq("lote_id", loteId);

        if (error) throw error;
        if (!records || records.length === 0) {
            return NextResponse.json({ error: "No consolidated records found for this lote" }, { status: 404 });
        }

        const topic = pubsub.topic(TOPICS.NC_TAREFAS);
        let count = 0;

        for (const record of records) {
            // Only fire if NC value > 0
            if (Number(record.valor_nc_final) <= 0) continue;

            const client = record.clientes as any;
            const cicloNome = client.ciclos_faturamento?.nome || "GERAL";

            // Format payload EXATAMENTE como o Worker Python espera
            const payload = {
                info_loja: {
                    LOJA: client.nome_fantasia || client.razao_social,
                    CNPJ: client.cnpj,
                    NC: Number(record.valor_nc_final).toFixed(2),
                    "Nº NF": record.numero_nf || "0",
                    Faturamento: cicloNome
                },
                nome_pasta_ciclo: cicloNome
            };

            const dataBuffer = Buffer.from(JSON.stringify(payload));
            await topic.publishMessage({ data: dataBuffer });
            count++;
        }

        // Update Lote status to CONCLUÍDO
        const { error: updateErr } = await supabase
            .from("faturamentos_lote")
            .update({ status: "CONCLUÍDO" })
            .eq("id", loteId);

        if (updateErr) throw updateErr;

        return NextResponse.json({
            success: true,
            message: `${count} tarefas enviadas para o Pub/Sub com sucesso.`
        });

    } catch (err: any) {
        console.error("Pub/Sub Dispatch Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
