-- ============================================================
-- Migration 036: Preencher clientes ativos com produto iWof Prime
-- ============================================================

DO $$
DECLARE
    prime_id UUID;
BEGIN
    -- Pegar o ID do iWof Prime
    SELECT id INTO prime_id FROM produtos_faturamento WHERE nome = 'iWof Prime' LIMIT 1;

    -- Atualizar todos os clientes ativos que ainda não têm um produto
    IF prime_id IS NOT NULL THEN
        UPDATE clientes
        SET produto_id = prime_id
        WHERE status = true AND produto_id IS NULL;
    END IF;
END $$;
