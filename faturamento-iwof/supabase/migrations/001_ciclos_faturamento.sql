-- ============================================================
-- MIGRATION: Ciclos de Faturamento como tabela dinâmica
-- Data: 2026-02-18
-- Descrição: Substitui o enum fixo por uma tabela lookup
--            que permite adicionar novos ciclos em runtime.
-- ============================================================

-- 1. Criar tabela de ciclos (lookup dinâmica)
CREATE TABLE IF NOT EXISTS ciclos_faturamento (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome  VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Popular com valores iniciais
INSERT INTO ciclos_faturamento (nome) VALUES
  ('SEMANAL'),
  ('QUINZENAL'),
  ('MENSAL'),
  ('NORDESTÃO'),
  ('QUEIROZ'),
  ('LETA')
ON CONFLICT (nome) DO NOTHING;

-- 3. Adicionar coluna FK em clientes (se ainda não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clientes' AND column_name = 'ciclo_faturamento_id'
  ) THEN
    ALTER TABLE clientes
      ADD COLUMN ciclo_faturamento_id UUID REFERENCES ciclos_faturamento(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- 4. RLS para a nova tabela
ALTER TABLE ciclos_faturamento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated full access on ciclos_faturamento" ON ciclos_faturamento;

CREATE POLICY "Authenticated full access on ciclos_faturamento"
  ON ciclos_faturamento FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 5. Índice na FK
CREATE INDEX IF NOT EXISTS idx_clientes_ciclo ON clientes(ciclo_faturamento_id);
