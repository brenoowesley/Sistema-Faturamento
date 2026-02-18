-- ============================================================
-- Migration 003: Allow anon access until auth is implemented
-- Run this in Supabase SQL Editor
-- ============================================================

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Authenticated full access on clientes" ON clientes;
DROP POLICY IF EXISTS "Authenticated full access on ciclos_faturamento" ON ciclos_faturamento;
DROP POLICY IF EXISTS "Authenticated full access on faturamentos_lote" ON faturamentos_lote;
DROP POLICY IF EXISTS "Authenticated full access on agendamentos_brutos" ON agendamentos_brutos;
DROP POLICY IF EXISTS "Authenticated full access on ajustes_faturamento" ON ajustes_faturamento;

-- Create permissive policies (anon + authenticated)
CREATE POLICY "Allow all access on clientes"
  ON clientes FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all access on ciclos_faturamento"
  ON ciclos_faturamento FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all access on faturamentos_lote"
  ON faturamentos_lote FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all access on agendamentos_brutos"
  ON agendamentos_brutos FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all access on ajustes_faturamento"
  ON ajustes_faturamento FOR ALL
  USING (true)
  WITH CHECK (true);
