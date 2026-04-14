-- ============================================================
-- Migration 038: Unique constraint para idempotência de emails
-- ============================================================
-- Impede que o mesmo email seja enviado/logado duas vezes
-- para o mesmo cliente no mesmo lote, protegendo contra
-- re-entrega do Pub/Sub e race conditions no Consumer.
-- ============================================================

-- 1. Limpar duplicados existentes (mantém apenas o registro mais recente)
DELETE FROM logs_envio_email
WHERE id NOT IN (
    SELECT DISTINCT ON (lote_id, cliente_id) id
    FROM logs_envio_email
    WHERE lote_id IS NOT NULL AND cliente_id IS NOT NULL
    ORDER BY lote_id, cliente_id, created_at DESC
)
AND lote_id IS NOT NULL
AND cliente_id IS NOT NULL;

-- 2. Criar unique constraint
ALTER TABLE logs_envio_email
    ADD CONSTRAINT uq_log_lote_cliente
    UNIQUE (lote_id, cliente_id);
