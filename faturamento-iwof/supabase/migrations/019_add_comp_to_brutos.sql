-- Migração 019: Adicionar data_competencia em agendamentos_brutos
-- Necessário para persistir a competência correta em agendamentos fatiados (Regra Queiroz)

ALTER TABLE public.agendamentos_brutos 
ADD COLUMN IF NOT EXISTS data_competencia DATE;

COMMENT ON COLUMN public.agendamentos_brutos.data_competencia IS 'Data de competência específica do agendamento (usada no fatiamento Queiroz)';
