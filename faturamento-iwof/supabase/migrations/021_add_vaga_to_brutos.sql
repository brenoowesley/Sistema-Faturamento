-- Migração 021: Adicionar vaga em agendamentos_brutos
-- Necessário para persistir a função/cargo do profissional e exibir corretamente na fatura gerada pelo GCP

ALTER TABLE public.agendamentos_brutos 
ADD COLUMN IF NOT EXISTS vaga VARCHAR(255);

COMMENT ON COLUMN public.agendamentos_brutos.vaga IS 'Nome da vaga/função ocupada pelo profissional no agendamento (coluna "Vaga" da planilha de origem)';
