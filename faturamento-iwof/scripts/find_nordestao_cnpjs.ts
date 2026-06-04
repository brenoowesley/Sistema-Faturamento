import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function findCnpjDuplicates() {
    // 1. Resolve o UUID real do ciclo Nordestão — não depende do nome do cliente
    const { data: ciclo, error: cicloErr } = await supabase
        .from("ciclos_faturamento")
        .select("id, nome")
        .eq("nome", "NORDESTÃO")
        .single();

    if (cicloErr || !ciclo) {
        console.error("Ciclo NORDESTÃO não encontrado na tabela ciclos_faturamento.", cicloErr);
        return;
    }

    console.log(`Ciclo encontrado: "${ciclo.nome}" (UUID: ${ciclo.id})\n`);

    // 2. Filtra clientes pelo FK ciclo_faturamento_id — imutável e preciso
    const { data: clientes, error } = await supabase
        .from("clientes")
        .select(`
            razao_social, 
            nome_fantasia, 
            cnpj, 
            ciclo_faturamento_id,
            ciclos_faturamento (nome)
        `)
        .eq("ciclo_faturamento_id", ciclo.id);

    if (error) {
        console.error("Error fetching", error);
        return;
    }

    const byCnpj = new Map<string, any[]>();
    for (const c of clientes || []) {
        if (!c.cnpj) continue;
        const cnpjNum = c.cnpj.replace(/\D/g, "");
        if (!byCnpj.has(cnpjNum)) byCnpj.set(cnpjNum, []);
        byCnpj.get(cnpjNum)!.push(c);
    }

    console.log("Nordestão CNPJs duplicated:");
    for (const [cnpj, lojas] of byCnpj.entries()) {
        if (lojas.length > 1) {
            console.log(`CNPJ: ${cnpj}`);
            lojas.forEach(l => console.log(` - ${l.razao_social} (${l.nome_fantasia || "Sem fantasia"})`));
        }
    }
}

findCnpjDuplicates();
