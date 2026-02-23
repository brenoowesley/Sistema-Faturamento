-- --------------------------------------------------------
-- Migration: Add nome_pasta to faturamentos_lote
-- --------------------------------------------------------

ALTER TABLE faturamentos_lote
ADD COLUMN IF NOT EXISTS nome_pasta VARCHAR(255);
