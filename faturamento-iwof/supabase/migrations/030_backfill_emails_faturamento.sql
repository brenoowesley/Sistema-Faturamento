-- ============================================================
-- 030: Backfill emails_faturamento com email_contato
-- ============================================================
-- Preenche o campo emails_faturamento de todos os clientes
-- que estão com esse campo vazio (NULL ou string vazia),
-- copiando o valor de email_contato quando disponível.
-- ============================================================

UPDATE clientes
SET    emails_faturamento = email_contato
WHERE  (emails_faturamento IS NULL OR TRIM(emails_faturamento) = '')
  AND  email_contato IS NOT NULL
  AND  TRIM(email_contato) <> '';
