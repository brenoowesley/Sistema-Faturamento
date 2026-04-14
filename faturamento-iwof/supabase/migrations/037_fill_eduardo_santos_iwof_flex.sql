-- ============================================================
-- Migration 037: Definir produto iWof Flex e código IBGE para EDUARDO SANTOS REPRESENTACOES LTDA
-- ============================================================

DO $$
DECLARE
    flex_id UUID;
BEGIN
    -- Pegar o ID do iWof Flex
    SELECT id INTO flex_id FROM produtos_faturamento WHERE nome = 'iWof Flex' LIMIT 1;

    -- Atualizar o cliente específico (produto e IBGE)
    IF flex_id IS NOT NULL THEN
        UPDATE clientes
        SET produto_id = flex_id,
            codigo_ibge = '2611606'
        WHERE razao_social = 'EDUARDO SANTOS REPRESENTACOES LTDA';
    ELSE
        -- Se por acaso o produto não existir, ainda preenche o IBGE
        UPDATE clientes
        SET codigo_ibge = '2611606'
        WHERE razao_social = 'EDUARDO SANTOS REPRESENTACOES LTDA';
    END IF;
END $$;
