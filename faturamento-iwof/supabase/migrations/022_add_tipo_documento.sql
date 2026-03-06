-- Adicionar coluna tipo_documento para diferenciar boletos desmembrados (NF e NC) do unificado
ALTER TABLE faturamento_consolidados ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(10) DEFAULT 'UNIFICADO';

-- Atualizar constraint única para permitir a inserção de dois registros (NF e NC) para a mesma loja no mesmo lote
ALTER TABLE faturamento_consolidados DROP CONSTRAINT IF EXISTS faturamento_consolidados_lote_id_cliente_id_cnpj_key;
ALTER TABLE faturamento_consolidados ADD CONSTRAINT faturamento_consolidados_lote_id_cliente_id_cnpj_tipo_key UNIQUE NULLS NOT DISTINCT (lote_id, cliente_id, cnpj_filial, tipo_documento);
