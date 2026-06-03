-- ============================================================
-- Migration 039: Fix F-08 + F-10 — Fechamento automático de lotes
-- ============================================================
-- F-10: Adiciona coluna concluido_em e cria função RPC que
--       fecha o lote em CONCLUIDO ou CONCLUIDO_COM_ERROS
--       de forma atômica após cada e-mail processado.
-- ============================================================

-- 1. Adicionar coluna concluido_em (registra quando o lote foi fechado)
ALTER TABLE faturamentos_lote
    ADD COLUMN IF NOT EXISTS concluido_em TIMESTAMPTZ;

-- 2. Criar (ou substituir) a função de fechamento atômico
--    Chamada pelo consumer após cada log de Sucesso ou Erro.
--    Só faz o UPDATE se TODOS os consolidados do lote já têm
--    log final (Sucesso ou Erro) — nunca fecha parcialmente.
CREATE OR REPLACE FUNCTION verificar_e_concluir_lote(p_lote_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER  -- executa com privilégios do dono (evita RLS)
AS $$
DECLARE
    v_total_consolidados  BIGINT;
    v_total_logs_finais   BIGINT;
    v_tem_erros           BOOLEAN;
    v_status_final        TEXT;
BEGIN
    -- Contar quantos consolidados existem para este lote
    SELECT COUNT(*)
    INTO v_total_consolidados
    FROM faturamento_consolidados
    WHERE lote_id = p_lote_id;

    -- Se não houver consolidados, nada a fazer
    IF v_total_consolidados = 0 THEN
        RETURN;
    END IF;

    -- Contar quantos têm log final (Sucesso ou Erro), sem duplicatas por cliente
    SELECT COUNT(DISTINCT cliente_id)
    INTO v_total_logs_finais
    FROM logs_envio_email
    WHERE lote_id = p_lote_id
      AND status IN ('Sucesso', 'Erro');

    -- Ainda há clientes sem log final — não fechar ainda
    IF v_total_logs_finais < v_total_consolidados THEN
        RETURN;
    END IF;

    -- Todos processados: determinar status final
    SELECT EXISTS (
        SELECT 1 FROM logs_envio_email
        WHERE lote_id = p_lote_id AND status = 'Erro'
    ) INTO v_tem_erros;

    v_status_final := CASE WHEN v_tem_erros THEN 'CONCLUIDO_COM_ERROS' ELSE 'CONCLUIDO' END;

    -- UPDATE atômico: só age se o lote ainda estiver em ENVIANDO
    -- (garante idempotência com múltiplos workers concorrentes)
    UPDATE faturamentos_lote
    SET
        status       = v_status_final,
        concluido_em = now()
    WHERE id     = p_lote_id
      AND status = 'ENVIANDO';

    -- Log para debugging no servidor
    IF FOUND THEN
        RAISE NOTICE '[verificar_e_concluir_lote] Lote % fechado como %', p_lote_id, v_status_final;
    END IF;
END;
$$;

-- 3. Conceder permissão de execução apenas para o service_role
--    (usado pelo consumer e pela API via supabaseAdmin)
GRANT EXECUTE ON FUNCTION verificar_e_concluir_lote(UUID) TO service_role;
