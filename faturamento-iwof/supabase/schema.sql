-- ============================================================
-- SCHEMA: Sistema de Faturamento IWOF
-- ============================================================

-- --------------------------------------------------------
-- 1. Tabela de Ciclos de Faturamento (lookup dinâmica)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS ciclos_faturamento (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome  VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Valores iniciais
INSERT INTO ciclos_faturamento (nome) VALUES
  ('SEMANAL'),
  ('QUINZENAL'),
  ('MENSAL'),
  ('NORDESTÃO'),
  ('QUEIROZ'),
  ('LETA')
ON CONFLICT (nome) DO NOTHING;

-- --------------------------------------------------------
-- 2. Tabela de Clientes
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identificação
  razao_social          VARCHAR(255) NOT NULL,
  nome_fantasia         VARCHAR(255),
  nome                  VARCHAR(255),
  cnpj                  VARCHAR(18) NOT NULL UNIQUE,
  cpf                   VARCHAR(14),
  id_estrangeiro        VARCHAR(50),
  inscricao_estadual    VARCHAR(20),
  codigo                VARCHAR(50),
  -- Contato
  email_principal       VARCHAR(255),
  telefone_principal    VARCHAR(30),
  emails_faturamento    TEXT,
  nome_contato          VARCHAR(255),
  email_contato         VARCHAR(255),
  -- Endereço
  cep                   VARCHAR(10),
  estado                VARCHAR(2),
  cidade                VARCHAR(150),
  endereco              VARCHAR(255),
  numero                VARCHAR(20),
  bairro                VARCHAR(150),
  complemento           VARCHAR(255),
  -- Operacional
  ciclo_faturamento_id  UUID REFERENCES ciclos_faturamento(id) ON DELETE SET NULL,
  tempo_pagamento_dias  INT DEFAULT 30,
  nome_conta_azul       VARCHAR(255),
  boleto_unificado      BOOLEAN DEFAULT false,
  -- Datas e Meta
  data_criacao          DATE,
  data_fundacao         DATE,
  observacoes           TEXT,
  status                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------
-- 3. Tabela de Lotes de Faturamento
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS faturamentos_lote (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_competencia  DATE NOT NULL,
  data_inicio_ciclo DATE NOT NULL,
  data_fim_ciclo    DATE NOT NULL,
  status            VARCHAR(50) NOT NULL DEFAULT 'PENDENTE',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------
-- 4. Tabela de Agendamentos Brutos
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS agendamentos_brutos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id             UUID NOT NULL REFERENCES faturamentos_lote(id) ON DELETE CASCADE,
  nome_profissional   VARCHAR(255) NOT NULL,
  loja_id             UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  cnpj_loja           VARCHAR(18),
  data_inicio         TIMESTAMPTZ NOT NULL,
  data_fim            TIMESTAMPTZ NOT NULL,
  valor_iwof          NUMERIC(12,2) NOT NULL DEFAULT 0,
  fracao_hora         NUMERIC(6,2) NOT NULL DEFAULT 0,
  status_validacao    VARCHAR(50) NOT NULL DEFAULT 'PENDENTE'
);

-- --------------------------------------------------------
-- 5. Tabela de Ajustes de Faturamento
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS ajustes_faturamento (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id        UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  tipo              VARCHAR(30) NOT NULL CHECK (tipo IN ('ACRESCIMO', 'DESCONTO', 'IRRF')),
  valor             NUMERIC(12,2) NOT NULL,
  motivo            TEXT,
  data_ocorrencia   DATE NOT NULL DEFAULT CURRENT_DATE,
  lote_aplicado_id  UUID REFERENCES faturamentos_lote(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE ciclos_faturamento    ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE faturamentos_lote     ENABLE ROW LEVEL SECURITY;
ALTER TABLE agendamentos_brutos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ajustes_faturamento   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated full access on ciclos_faturamento"
  ON ciclos_faturamento FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated full access on clientes"
  ON clientes FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated full access on faturamentos_lote"
  ON faturamentos_lote FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated full access on agendamentos_brutos"
  ON agendamentos_brutos FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated full access on ajustes_faturamento"
  ON ajustes_faturamento FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_clientes_cnpj ON clientes(cnpj);
CREATE INDEX IF NOT EXISTS idx_clientes_ciclo ON clientes(ciclo_faturamento_id);
CREATE INDEX IF NOT EXISTS idx_agendamentos_lote ON agendamentos_brutos(lote_id);
CREATE INDEX IF NOT EXISTS idx_agendamentos_loja ON agendamentos_brutos(loja_id);
CREATE INDEX IF NOT EXISTS idx_ajustes_cliente ON ajustes_faturamento(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ajustes_lote ON ajustes_faturamento(lote_aplicado_id);
