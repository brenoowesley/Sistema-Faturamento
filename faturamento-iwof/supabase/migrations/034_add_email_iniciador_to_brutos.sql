-- Migração 034: Adicionar email_iniciador em agendamentos_brutos
-- Armazena o e-mail de quem iniciou o agendamento (coluna "Email do Iniciador" da planilha de origem)

ALTER TABLE public.agendamentos_brutos 
ADD COLUMN IF NOT EXISTS email_iniciador VARCHAR(255);

COMMENT ON COLUMN public.agendamentos_brutos.email_iniciador IS 'E-mail do profissional que iniciou o agendamento (coluna "Email do Iniciador" da planilha de origem)';
