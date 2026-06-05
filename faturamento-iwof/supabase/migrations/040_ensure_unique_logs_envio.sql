-- ============================================================
-- Migration 040: Garantir UNIQUE constraint em logs_envio_email
-- ============================================================
-- A migration 038 pode não ter sido aplicada em todos os ambientes.
-- Esta migration é idempotente: verifica se o constraint já existe
-- antes de tentar criar, e limpa duplicados caso necessário.
-- ============================================================

DO $$
BEGIN
    -- Verificar se o constraint já existe
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'uq_log_lote_cliente'
          AND conrelid = 'logs_envio_email'::regclass
    ) THEN
        -- 1. Limpar duplicados existentes (mantém o registro mais recente por par lote/cliente)
        DELETE FROM logs_envio_email
        WHERE id NOT IN (
            SELECT DISTINCT ON (lote_id, cliente_id) id
            FROM logs_envio_email
            WHERE lote_id IS NOT NULL AND cliente_id IS NOT NULL
            ORDER BY lote_id, cliente_id, created_at DESC
        )
        AND lote_id IS NOT NULL
        AND cliente_id IS NOT NULL;

        -- 2. Criar o constraint UNIQUE
        ALTER TABLE logs_envio_email
            ADD CONSTRAINT uq_log_lote_cliente
            UNIQUE (lote_id, cliente_id);

        RAISE NOTICE 'Constraint uq_log_lote_cliente criado com sucesso.';
    ELSE
        RAISE NOTICE 'Constraint uq_log_lote_cliente já existe. Nenhuma ação necessária.';
    END IF;
END $$;
