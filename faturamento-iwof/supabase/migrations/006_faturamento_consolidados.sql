-- --------------------------------------------------------
-- Migration: Add Consolidation Table
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS faturamento_consolidados (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id             UUID NOT NULL REFERENCES faturamentos_lote(id) ON DELETE CASCADE,
  cliente_id          UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  
  -- Valores Base
  valor_bruto         NUMERIC(12,2) NOT NULL DEFAULT 0,
  acrescimos          NUMERIC(12,2) NOT NULL DEFAULT 0,
  descontos           NUMERIC(12,2) NOT NULL DEFAULT 0,
  
  -- Fiscal (Lido do XML)
  valor_irrf          NUMERIC(12,2) NOT NULL DEFAULT 0,
  numero_nf           VARCHAR(50),
  valor_nf_emitida    NUMERIC(12,2) NOT NULL DEFAULT 0,
  
  -- Resultados Finais
  valor_nc_final      NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_boleto_final  NUMERIC(12,2) NOT NULL DEFAULT 0,
  
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE faturamento_consolidados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated full access on faturamento_consolidados"
  ON faturamento_consolidados FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Indices
CREATE INDEX IF NOT EXISTS idx_consolidados_lote ON faturamento_consolidados(lote_id);
CREATE INDEX IF NOT EXISTS idx_consolidados_cliente ON faturamento_consolidados(cliente_id);
