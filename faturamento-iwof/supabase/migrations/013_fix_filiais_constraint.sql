-- Add the cnpj_filial column to store the specific branch CNPJ for accurate branch-level NFE exporting
ALTER TABLE faturamento_consolidados ADD COLUMN IF NOT EXISTS cnpj_filial VARCHAR(18);

-- Remove the old constraint that forces branches to overwrite the Matriz
ALTER TABLE faturamento_consolidados DROP CONSTRAINT IF EXISTS faturamento_consolidados_lote_id_cliente_id_key;

-- Add the new constraint that includes the branch CNPJ, so a Matriz can have multiple branches in the same Lote
ALTER TABLE faturamento_consolidados ADD CONSTRAINT faturamento_consolidados_lote_id_cliente_id_cnpj_key UNIQUE NULLS NOT DISTINCT (lote_id, cliente_id, cnpj_filial);
