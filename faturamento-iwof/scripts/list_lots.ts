
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function listLots() {
    const { data, error } = await supabase
        .from("faturamentos_lote")
        .select("id, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5);

    if (error) {
        console.error("Error listing lots:", error.message);
        return;
    }
    console.log(JSON.stringify(data, null, 2));
}

listLots();
