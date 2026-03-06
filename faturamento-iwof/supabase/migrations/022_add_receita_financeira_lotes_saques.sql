-- --------------------------------------------------------
-- Migration: Add receita_financeira column to lotes_saques
-- --------------------------------------------------------

ALTER TABLE lotes_saques
ADD COLUMN IF NOT EXISTS receita_financeira NUMERIC(12,2);
