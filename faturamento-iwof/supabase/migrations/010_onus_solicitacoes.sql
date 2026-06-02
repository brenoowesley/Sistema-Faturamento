-- ============================================================
-- MIGRATION 010: Tabela de Solicitações de Ônus a Usuário
-- Formulário externo → Aprovação admin → Ajuste de faturamento
-- ============================================================

CREATE TABLE IF NOT EXISTS onus_solicitacoes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Dados do formulário externo
  cnpj_loja         VARCHAR(18) NOT NULL,
  nome_loja         VARCHAR(255) NOT NULL,
  nome_usuario      VARCHAR(255) NOT NULL,
  data_agendamento  DATE NOT NULL,
  descricao         TEXT NOT NULL,
  valor             NUMERIC(12,2) NOT NULL,
  anexo_url         TEXT,
  canal_recebimento VARCHAR(50) NOT NULL CHECK (
    canal_recebimento IN ('tasky', 'email', 'formulario', 'outros')
  ),
  canal_link        TEXT,
  email_solicitante VARCHAR(255),

  -- Match automático com a base de clientes
  cliente_id        UUID REFERENCES clientes(id) ON DELETE SET NULL,
  loja_identificada BOOLEAN DEFAULT false,

  -- Workflow de aprovação
  status            VARCHAR(30) NOT NULL DEFAULT 'pendente' CHECK (
    status IN ('pendente', 'aprovado', 'recusado')
  ),
  tipo_ajuste       VARCHAR(30) CHECK (tipo_ajuste IN ('ACRESCIMO', 'DESCONTO')),
  ajuste_gerado_id  UUID REFERENCES ajustes_faturamento(id) ON DELETE SET NULL,

  -- Auditoria
  aprovado_por      UUID,
  aprovado_em       TIMESTAMPTZ,
  motivo_recusa     TEXT,
  observacao_admin  TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE onus_solicitacoes ENABLE ROW LEVEL SECURITY;

-- Permitir INSERT público (formulário externo sem auth)
CREATE POLICY "Public insert on onus_solicitacoes"
  ON onus_solicitacoes FOR INSERT
  WITH CHECK (true);

-- Acesso completo para usuários autenticados (admin)
CREATE POLICY "Authenticated full access on onus_solicitacoes"
  ON onus_solicitacoes FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_onus_cnpj ON onus_solicitacoes(cnpj_loja);
CREATE INDEX IF NOT EXISTS idx_onus_status ON onus_solicitacoes(status);
CREATE INDEX IF NOT EXISTS idx_onus_cliente ON onus_solicitacoes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_onus_created ON onus_solicitacoes(created_at);

-- ============================================================
-- STORAGE BUCKET (executar manualmente no Supabase Dashboard)
-- ============================================================
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('onus-anexos', 'onus-anexos', true)
-- ON CONFLICT (id) DO NOTHING;
