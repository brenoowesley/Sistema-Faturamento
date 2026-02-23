
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function diagnostic(loteId: string) {
    console.log(`Checking Lote: ${loteId}`);

    const { data: lote, error: loteErr } = await supabase
        .from("faturamentos_lote")
        .select("*")
        .eq("id", loteId)
        .single();

    if (loteErr) {
        console.error("Lote not found:", loteErr.message);
        return;
    }
    console.log("Lote Status:", lote.status);

    const { data: consolidados, error: consErr } = await supabase
        .from("faturamento_consolidados")
        .select("count", { count: "exact" })
        .eq("lote_id", loteId);

    if (consErr) {
        console.error("Error fetching consolidados:", consErr.message);
    } else {
        console.log("Consolidados count:", consolidados?.length || 0);
    }

    const { data: agendamentos, error: agErr } = await supabase
        .from("agendamentos_brutos")
        .select("count", { count: "exact" })
        .eq("lote_id", loteId)
        .eq("status_validacao", "VALIDADO");

    if (agErr) {
        console.error("Error fetching agendamentos:", agErr.message);
    } else {
        console.log("Agendamentos (VALIDADO) count:", agendamentos?.length || 0);
    }
}

const targetLoteId = process.argv[2];
if (targetLoteId) {
    diagnostic(targetLoteId);
} else {
    console.log("Please provide a loteId as an argument.");
}
