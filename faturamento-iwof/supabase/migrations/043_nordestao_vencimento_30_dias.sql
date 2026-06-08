-- ============================================================
-- MIGRATION 043: Define tempo_pagamento_dias = 30 para lojas
--                do ciclo NORDESTÃO
-- Data: 2026-06-08
-- Motivo: Padronizar prazo de vencimento dos boletos das lojas
--         Nordestão para 30 dias corridos.
-- ============================================================

UPDATE public.clientes
SET    tempo_pagamento_dias = 30
WHERE  ciclo_faturamento_id = (
    SELECT id
    FROM   public.ciclos_faturamento
    WHERE  UPPER(nome) = 'NORDESTÃO'
    LIMIT  1
)
AND (tempo_pagamento_dias IS DISTINCT FROM 30);

-- Confirmação: retorna quantas lojas foram afetadas
-- (execute após a migration para auditoria)
-- SELECT COUNT(*) AS lojas_atualizadas
-- FROM public.clientes c
-- JOIN public.ciclos_faturamento cf ON cf.id = c.ciclo_faturamento_id
-- WHERE UPPER(cf.nome) = 'NORDESTÃO'
--   AND c.tempo_pagamento_dias = 30;
