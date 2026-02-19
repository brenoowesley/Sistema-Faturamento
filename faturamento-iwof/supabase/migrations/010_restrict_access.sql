-- ============================================================
-- Migration 010: Restrict access to authenticated users only
-- Revokes any previous anonymous (anon) access policies.
-- ============================================================

-- 1. Drop existing permissive policies
DROP POLICY IF EXISTS "Allow all access on clientes" ON clientes;
DROP POLICY IF EXISTS "Allow all access on ciclos_faturamento" ON ciclos_faturamento;
DROP POLICY IF EXISTS "Allow all access on faturamentos_lote" ON faturamentos_lote;
DROP POLICY IF EXISTS "Allow all access on agendamentos_brutos" ON agendamentos_brutos;
DROP POLICY IF EXISTS "Allow all access on ajustes_faturamento" ON ajustes_faturamento;
DROP POLICY IF EXISTS "Authenticated full access on faturamento_consolidados" ON faturamento_consolidados;
DROP POLICY IF EXISTS "Allow all access on faturamento_consolidados" ON faturamento_consolidados;

-- 2. Create restrictive policies (Authenticated ONLY)

-- CLIENTES
CREATE POLICY "Authenticated users can manage clientes"
  ON clientes FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- CICLOS
CREATE POLICY "Authenticated users can manage ciclos"
  ON ciclos_faturamento FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- LOTES
CREATE POLICY "Authenticated users can manage lotes"
  ON faturamentos_lote FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- AGENDAMENTOS
CREATE POLICY "Authenticated users can manage agendamentos"
  ON agendamentos_brutos FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- AJUSTES
CREATE POLICY "Authenticated users can manage ajustes"
  ON ajustes_faturamento FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- CONSOLIDADOS
CREATE POLICY "Authenticated users can manage consolidados"
  ON faturamento_consolidados FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 3. Disable anonymous access to everything
-- By default, if no USING(true) for 'anon' is present, they have no access.
-- The policies above explicitly use 'TO authenticated'.
