-- Fix para o erro de chave duplicada no FechamentoLote em clientes com split de competência (Ex: Queiroz)
-- Isso permite salvar dois registros "UNIFICADO" (ou NF/NC) para o mesmo CNPJ no mesmo Lote, desde que a data de competência seja diferente.
ALTER TABLE faturamento_consolidados DROP CONSTRAINT IF EXISTS faturamento_consolidados_lote_id_cliente_id_cnpj_tipo_key;
ALTER TABLE faturamento_consolidados ADD CONSTRAINT faturamento_consolidados_lote_id_cliente_id_cnpj_tipo_comp_key UNIQUE NULLS NOT DISTINCT (lote_id, cliente_id, cnpj_filial, tipo_documento, data_competencia);
