-- Migration: 033_add_cancelado_status.sql
-- Description: Adds 'CANCELADO' to the valid status values for faturamentos_lote.
--              Allows the "Parar Envio" feature to flag a lote as cancelled,
--              preventing the consumer from processing remaining Pub/Sub messages.

ALTER TABLE public.faturamentos_lote
DROP CONSTRAINT IF EXISTS faturamentos_lote_status_check;

ALTER TABLE public.faturamentos_lote
ADD CONSTRAINT faturamentos_lote_status_check 
CHECK (status IN ('PENDENTE', 'RASCUNHO', 'CONSOLIDADO', 'FISCAL', 'PROCESSING', 'ENVIANDO', 'FECHADO', 'CANCELADO'));

COMMENT ON COLUMN public.faturamentos_lote.status IS 'Status do lote: PENDENTE, CONSOLIDADO, FISCAL, PROCESSING (Cálculo), ENVIANDO (Disparo E-mails), CANCELADO (Envio interrompido)';
