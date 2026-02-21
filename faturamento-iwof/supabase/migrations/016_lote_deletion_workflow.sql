-- migração 016: Workflow de Exclusão de Lotes
-- Adiciona colunas para controle de solicitações de exclusão
ALTER TABLE public.faturamentos_lote
  ADD COLUMN IF NOT EXISTS delete_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delete_requested_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS delete_reason TEXT,
  ADD COLUMN IF NOT EXISTS delete_request_status TEXT CHECK (delete_request_status IN ('PENDING', 'REJECTED', 'APPROVED')) DEFAULT NULL;

-- Função para exclusão segura de lote por um ADMIN
-- Isso limpa os dados vinculados e reseta os ajustes
CREATE OR REPLACE FUNCTION public.safe_delete_lote(target_lote_id UUID)
RETURNS VOID AS $$
BEGIN
    -- 1. Verificar se quem chama é ADMIN
    IF (SELECT cargo FROM public.usuarios_perfis WHERE id = auth.uid()) != 'ADMIN' THEN
        RAISE EXCEPTION 'Apenas administradores podem excluir lotes diretamente.';
    END IF;

    -- 2. Resetar ajustes vinculados
    UPDATE public.ajustes_faturamento
    SET status_aplicacao = false,
        data_aplicacao = null,
        lote_aplicado_id = null
    WHERE lote_aplicado_id = target_lote_id;

    -- 3. Deletar consolidados (já tem ON DELETE CASCADE, mas vamos ser explícitos se necessário)
    -- DELETE FROM public.faturamento_consolidados WHERE lote_id = target_lote_id;

    -- 4. Deletar agendamentos brutos (já tem ON DELETE CASCADE)
    -- DELETE FROM public.agendamentos_brutos WHERE lote_id = target_lote_id;

    -- 5. Deletar o lote
    DELETE FROM public.faturamentos_lote WHERE id = target_lote_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
