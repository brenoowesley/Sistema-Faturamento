-- Migração 018: Suporte à Regra Queiroz (Fatiamento de Mês)

-- 1. Adicionar colunas de configuração de fatiamento no Lote
ALTER TABLE public.faturamentos_lote 
ADD COLUMN IF NOT EXISTS queiroz_split_date DATE,
ADD COLUMN IF NOT EXISTS queiroz_comp_anterior DATE,
ADD COLUMN IF NOT EXISTS queiroz_comp_atual DATE;

-- 2. Garantir coluna data_competencia na consolidação
ALTER TABLE public.faturamento_consolidados 
ADD COLUMN IF NOT EXISTS data_competencia DATE;

-- 3. Comentários para documentação
COMMENT ON COLUMN public.faturamentos_lote.queiroz_split_date IS 'Data limite do primeiro mês no fatiamento Queiroz';
COMMENT ON COLUMN public.faturamentos_lote.queiroz_comp_anterior IS 'Data de competência para o período anterior ao fatiamento';
COMMENT ON COLUMN public.faturamentos_lote.queiroz_comp_atual IS 'Data de competência para o período posterior ao fatiamento';
