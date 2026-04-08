-- ============================================================
-- 031: Adiciona cliente_id à tabela logs_envio_email
-- ============================================================
-- Corrige o bug onde a fila de envio não atualiza porque a
-- comparação era feita por nome (string), que divergia entre
-- a query de consolidados e o log gravado pelo emailService.
-- Agora a comparação usa cliente_id (UUID), que é confiável.
-- ============================================================

ALTER TABLE logs_envio_email
ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id);

-- Cria índice para acelerar o lookup por lote + cliente
CREATE INDEX IF NOT EXISTS idx_logs_envio_email_cliente
ON logs_envio_email (lote_id, cliente_id);
