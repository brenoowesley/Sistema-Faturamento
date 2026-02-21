-- migração 017: Regras de Exceção Leta e Nordestão
-- 1. Suporte para agrupamento financeiro (Loja Mãe)
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS loja_mae_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL;

-- 2. Garantir que o ciclo Nordestão exista (se não existir)
INSERT INTO public.ciclos_faturamento (nome) 
VALUES ('NORDESTÃO') 
ON CONFLICT (nome) DO NOTHING;

-- 3. Coluna para observações no relatório (Descritivo de Horas)
ALTER TABLE public.faturamento_consolidados ADD COLUMN IF NOT EXISTS observacao_report TEXT;

-- 4. Índices para performance
CREATE INDEX IF NOT EXISTS idx_clientes_loja_mae ON public.clientes(loja_mae_id);

