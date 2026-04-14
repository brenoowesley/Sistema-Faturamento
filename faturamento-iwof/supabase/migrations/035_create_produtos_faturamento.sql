-- ============================================================
-- Migration 035: Criar tabela produtos_faturamento e vincular a clientes
-- ============================================================

-- 1. Tabela de Produtos de Faturamento
CREATE TABLE IF NOT EXISTS produtos_faturamento (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL UNIQUE,
    porcentagem_nf NUMERIC(5, 2) NOT NULL DEFAULT 11.5,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Seed: produtos iniciais
INSERT INTO produtos_faturamento (nome, porcentagem_nf) VALUES
    ('iWof Prime', 11.5),
    ('iWof Flex', 40.0)
ON CONFLICT (nome) DO NOTHING;

-- 3. Adicionar FK na tabela clientes
ALTER TABLE clientes
    ADD COLUMN IF NOT EXISTS produto_id UUID REFERENCES produtos_faturamento(id) ON DELETE SET NULL;

-- 4. RLS: Permitir leitura para todos os roles autenticados
ALTER TABLE produtos_faturamento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read produtos_faturamento"
    ON produtos_faturamento FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can manage produtos_faturamento"
    ON produtos_faturamento FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- 5. Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_produtos_faturamento_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_produtos_faturamento_updated_at
    BEFORE UPDATE ON produtos_faturamento
    FOR EACH ROW
    EXECUTE FUNCTION update_produtos_faturamento_updated_at();
