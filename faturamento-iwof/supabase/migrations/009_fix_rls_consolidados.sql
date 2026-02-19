-- ============================================================
-- Migration 009: Fix RLS for faturamento_consolidados
-- Allow anon access to match previous migration 003
-- ============================================================

-- Drop restrictive policy
DROP POLICY IF EXISTS "Authenticated full access on faturamento_consolidados" ON faturamento_consolidados;

-- Create permissive policy (anon + authenticated)
CREATE POLICY "Allow all access on faturamento_consolidados"
  ON faturamento_consolidados FOR ALL
  USING (true)
  WITH CHECK (true);
