// Script para marcar todos ajustes pendentes como aplicados
// Executa via: npx tsx scripts/aplicar-pendentes.ts

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Variáveis NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  // 1. Buscar todos os ajustes pendentes
  const { data: pendentes, error: fetchError } = await supabase
    .from("ajustes_faturamento")
    .select("id, tipo, valor, motivo, nome_profissional, data_ocorrencia, cliente_id, clientes(razao_social, nome_fantasia)")
    .eq("status_aplicacao", false)
    .order("tipo")
    .order("data_ocorrencia", { ascending: false });

  if (fetchError) {
    console.error("❌ Erro ao buscar pendentes:", fetchError.message);
    process.exit(1);
  }

  if (!pendentes || pendentes.length === 0) {
    console.log("✅ Nenhum ajuste pendente encontrado.");
    return;
  }

  // 2. Exibir resumo
  const acrescimos = pendentes.filter(p => p.tipo === "ACRESCIMO");
  const descontos = pendentes.filter(p => p.tipo === "DESCONTO");
  const irrfs = pendentes.filter(p => p.tipo === "IRRF");

  const fmtCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  console.log("═══════════════════════════════════════════════════════");
  console.log("  AJUSTES PENDENTES — RESUMO");
  console.log("═══════════════════════════════════════════════════════\n");

  console.log(`  Total: ${pendentes.length} ajustes pendentes\n`);

  if (acrescimos.length > 0) {
    console.log(`  📈 ACRÉSCIMOS (${acrescimos.length}):`);
    const totalAcr = acrescimos.reduce((acc, a) => acc + Number(a.valor), 0);
    acrescimos.forEach(a => {
      const loja = (a as any).clientes?.nome_fantasia || (a as any).clientes?.razao_social || "-";
      console.log(`     • ${loja} | ${a.nome_profissional || "-"} | ${fmtCurrency(Number(a.valor))} | ${a.data_ocorrencia} | ${a.motivo || "-"}`);
    });
    console.log(`     TOTAL ACRÉSCIMOS: ${fmtCurrency(totalAcr)}\n`);
  }

  if (descontos.length > 0) {
    console.log(`  📉 DESCONTOS (${descontos.length}):`);
    const totalDesc = descontos.reduce((acc, a) => acc + Number(a.valor), 0);
    descontos.forEach(a => {
      const loja = (a as any).clientes?.nome_fantasia || (a as any).clientes?.razao_social || "-";
      console.log(`     • ${loja} | ${a.nome_profissional || "-"} | ${fmtCurrency(Number(a.valor))} | ${a.data_ocorrencia} | ${a.motivo || "-"}`);
    });
    console.log(`     TOTAL DESCONTOS: ${fmtCurrency(totalDesc)}\n`);
  }

  if (irrfs.length > 0) {
    console.log(`  🏛️  IRRF (${irrfs.length}):`);
    const totalIrrf = irrfs.reduce((acc, a) => acc + Number(a.valor), 0);
    irrfs.forEach(a => {
      const loja = (a as any).clientes?.nome_fantasia || (a as any).clientes?.razao_social || "-";
      console.log(`     • ${loja} | ${fmtCurrency(Number(a.valor))} | ${a.data_ocorrencia}`);
    });
    console.log(`     TOTAL IRRF: ${fmtCurrency(totalIrrf)}\n`);
  }

  // 3. Atualizar todos para aplicado
  const ids = pendentes.map(p => p.id);
  const hoje = new Date().toISOString().split("T")[0]; // 2026-06-02

  console.log(`\n  ⏳ Atualizando ${ids.length} ajustes para status_aplicacao=true, data_aplicacao=${hoje}...\n`);

  const { error: updateError, count } = await supabase
    .from("ajustes_faturamento")
    .update({ status_aplicacao: true, data_aplicacao: hoje })
    .in("id", ids);

  if (updateError) {
    console.error("❌ Erro ao atualizar:", updateError.message);
    process.exit(1);
  }

  console.log(`  ✅ ${ids.length} ajustes marcados como APLICADO em ${hoje}.`);
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch(console.error);
