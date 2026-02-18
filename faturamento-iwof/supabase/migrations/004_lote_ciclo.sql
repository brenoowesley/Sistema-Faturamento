-- ============================================================
-- Migration 004: Add ciclo_faturamento_id to faturamentos_lote
-- Run this in Supabase SQL Editor
-- ============================================================

ALTER TABLE faturamentos_lote
  ADD COLUMN IF NOT EXISTS ciclo_faturamento_id UUID REFERENCES ciclos_faturamento(id) ON DELETE SET NULL;
