-- --------------------------------------------------------
-- Migration: Create lotes_saques table if not exists,
--            or add all missing columns to an existing table.
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS lotes_saques (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome_lote       TEXT NOT NULL,
    tipo_saque      TEXT,
    total_solicitado NUMERIC(12,2),
    total_real       NUMERIC(12,2),
    receita_financeira NUMERIC(12,2),
    status          TEXT NOT NULL DEFAULT 'Exportado',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent: add each column only if it doesn't exist yet
ALTER TABLE lotes_saques ADD COLUMN IF NOT EXISTS nome_lote           TEXT;
ALTER TABLE lotes_saques ADD COLUMN IF NOT EXISTS tipo_saque          TEXT;
ALTER TABLE lotes_saques ADD COLUMN IF NOT EXISTS total_solicitado    NUMERIC(12,2);
ALTER TABLE lotes_saques ADD COLUMN IF NOT EXISTS total_real          NUMERIC(12,2);
ALTER TABLE lotes_saques ADD COLUMN IF NOT EXISTS receita_financeira  NUMERIC(12,2);
ALTER TABLE lotes_saques ADD COLUMN IF NOT EXISTS status              TEXT;
ALTER TABLE lotes_saques ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ DEFAULT NOW();

-- --------------------------------------------------------
-- Create itens_saque table if not exists
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS itens_saque (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lote_id          UUID REFERENCES lotes_saques(id) ON DELETE CASCADE,
    cpf_conta        TEXT,
    cpf_favorecido   TEXT,
    nome_usuario     TEXT,
    chave_pix        TEXT,
    tipo_pix         TEXT,
    valor            NUMERIC(12,2),
    valor_solicitado NUMERIC(12,2),
    data_solicitacao TIMESTAMPTZ,
    status_item      TEXT NOT NULL DEFAULT 'APROVADO',
    motivo_bloqueio  TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE itens_saque ADD COLUMN IF NOT EXISTS cpf_conta        TEXT;
ALTER TABLE itens_saque ADD COLUMN IF NOT EXISTS cpf_favorecido   TEXT;
ALTER TABLE itens_saque ADD COLUMN IF NOT EXISTS nome_usuario     TEXT;
ALTER TABLE itens_saque ADD COLUMN IF NOT EXISTS chave_pix        TEXT;
ALTER TABLE itens_saque ADD COLUMN IF NOT EXISTS tipo_pix         TEXT;
ALTER TABLE itens_saque ADD COLUMN IF NOT EXISTS valor            NUMERIC(12,2);
ALTER TABLE itens_saque ADD COLUMN IF NOT EXISTS valor_solicitado NUMERIC(12,2);
ALTER TABLE itens_saque ADD COLUMN IF NOT EXISTS data_solicitacao TIMESTAMPTZ;
ALTER TABLE itens_saque ADD COLUMN IF NOT EXISTS status_item      TEXT;
ALTER TABLE itens_saque ADD COLUMN IF NOT EXISTS motivo_bloqueio  TEXT;
