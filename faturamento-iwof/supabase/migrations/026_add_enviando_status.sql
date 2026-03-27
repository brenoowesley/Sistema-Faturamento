-- Migration: 026_add_enviando_status.sql
-- Description: Ensures the status column in faturamentos_lote can handle the 'ENVIANDO' state.
--              We add a check constraint to define valid states.

ALTER TABLE public.faturamentos_lote
DROP CONSTRAINT IF EXISTS faturamentos_lote_status_check;

ALTER TABLE public.faturamentos_lote
ADD CONSTRAINT faturamentos_lote_status_check 
CHECK (status IN ('PENDENTE', 'CONSOLIDADO', 'FISCAL', 'PROCESSING', 'ENVIANDO'));

COMMENT ON COLUMN public.faturamentos_lote.status IS 'Status do lote: PENDENTE, CONSOLIDADO, FISCAL, PROCESSING (Cálculo), ENVIANDO (Disparo E-mails)';
