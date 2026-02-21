-- Adiciona a coluna faltante apontada no erro: "Could not find the 'valor_ir_xml' column of 'faturamento_consolidados'"
ALTER TABLE faturamento_consolidados ADD COLUMN IF NOT EXISTS valor_ir_xml numeric(15,2) DEFAULT 0.00;

-- Cria a restrição única para permitir o UPSERT (ON CONFLICT) na tela de processamento fiscal
ALTER TABLE faturamento_consolidados DROP CONSTRAINT IF EXISTS faturamento_consolidados_lote_id_cliente_id_key;
ALTER TABLE faturamento_consolidados ADD CONSTRAINT faturamento_consolidados_lote_id_cliente_id_key UNIQUE (lote_id, cliente_id);
