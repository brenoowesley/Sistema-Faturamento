-- ============================================================
-- Migration 032: Backfill cliente_id nos logs antiguos
-- ============================================================
-- Problema: Logs de envio anteriores à atualização não possuem
-- cliente_id, impossibilitando a comparação confiável entre
-- consolidados e logs para o "Continuar Envio".
--
-- Solução: Cruzar logs_envio_email com faturamento_consolidados
-- e clientes para preencher o cliente_id baseado no lote_id +
-- correspondência por nome (tentando todos os campos de nome).
-- ============================================================

-- Tentativa 1: Match por razao_social
UPDATE logs_envio_email AS l
SET cliente_id = fc.cliente_id
FROM faturamento_consolidados AS fc
JOIN clientes AS c ON c.id = fc.cliente_id
WHERE l.lote_id = fc.lote_id
  AND l.cliente_id IS NULL
  AND l.cliente_nome IS NOT NULL
  AND TRIM(LOWER(l.cliente_nome)) = TRIM(LOWER(c.razao_social));

-- Tentativa 2: Match por nome_conta_azul (para os que sobraram)
UPDATE logs_envio_email AS l
SET cliente_id = fc.cliente_id
FROM faturamento_consolidados AS fc
JOIN clientes AS c ON c.id = fc.cliente_id
WHERE l.lote_id = fc.lote_id
  AND l.cliente_id IS NULL
  AND l.cliente_nome IS NOT NULL
  AND TRIM(LOWER(l.cliente_nome)) = TRIM(LOWER(c.nome_conta_azul));

-- Tentativa 3: Match por nome (para os que ainda sobraram)
UPDATE logs_envio_email AS l
SET cliente_id = fc.cliente_id
FROM faturamento_consolidados AS fc
JOIN clientes AS c ON c.id = fc.cliente_id
WHERE l.lote_id = fc.lote_id
  AND l.cliente_id IS NULL
  AND l.cliente_nome IS NOT NULL
  AND TRIM(LOWER(l.cliente_nome)) = TRIM(LOWER(c.nome));

-- ============================================================
-- Diagnóstico: Ver quantos logs ficaram sem cliente_id
-- ============================================================
-- Execute após a migração para verificar:
-- SELECT COUNT(*) AS total_sem_cliente_id
-- FROM logs_envio_email
-- WHERE cliente_id IS NULL;
