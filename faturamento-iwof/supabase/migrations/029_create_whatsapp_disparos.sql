-- ============================================================
-- MIGRATION 029: Central de Disparos WhatsApp
-- Tabelas para templates de mensagem e logs de disparo
-- ============================================================

-- --------------------------------------------------------
-- 1. Tabela de Templates de WhatsApp
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       VARCHAR(100) NOT NULL UNIQUE,
  conteudo   TEXT NOT NULL,
  categoria  VARCHAR(50) NOT NULL DEFAULT 'FATURAMENTO'
             CHECK (categoria IN ('FATURAMENTO', 'COMUNICADO', 'COBRANCA')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------
-- 2. Tabela de Logs de Disparo (Idempotência)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS disparo_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id       UUID REFERENCES faturamentos_lote(id) ON DELETE SET NULL,
  cnpj          VARCHAR(18) NOT NULL,
  telefone      VARCHAR(30) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'PENDENTE'
                CHECK (status IN ('PENDENTE', 'ENVIADO', 'ERRO')),
  error_message TEXT,
  enviado_em    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Constraint de idempotência: impede envio duplicado no mesmo lote
  CONSTRAINT uq_disparo_lote_cnpj UNIQUE (lote_id, cnpj)
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE disparo_logs       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated full access on whatsapp_templates"
  ON whatsapp_templates FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated full access on disparo_logs"
  ON disparo_logs FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_disparo_logs_lote   ON disparo_logs(lote_id);
CREATE INDEX IF NOT EXISTS idx_disparo_logs_cnpj   ON disparo_logs(cnpj);
CREATE INDEX IF NOT EXISTS idx_disparo_logs_status ON disparo_logs(status);

-- ============================================================
-- SEED: Template padrão de faturamento
-- ============================================================
INSERT INTO whatsapp_templates (nome, conteudo, categoria) VALUES
  (
    'Aviso de Faturamento Padrão',
    'Olá, {{primeiro_nome}}! 👋

Informamos que o faturamento referente ao lote *{{nome_lote}}* foi processado.

📋 *Empresa:* {{razao_social}}
💰 *Valor Total:* R$ {{valor_total}}
📅 *Vencimento:* {{vencimento}}

Em caso de dúvidas, entre em contato com nosso financeiro.

_iWof — Gestão Inteligente de Faturamento_',
    'FATURAMENTO'
  ),
  (
    'Lembrete de Vencimento',
    'Olá, {{primeiro_nome}}! ⏰

Lembramos que a fatura da empresa *{{nome_fantasia}}* vence em *{{vencimento}}*.

💰 *Valor:* R$ {{valor_total}}

Por favor, providencie o pagamento para evitar pendências.

_iWof — Gestão Inteligente de Faturamento_',
    'COBRANCA'
  ),
  (
    'Comunicado Geral',
    'Olá, {{primeiro_nome}}! 📢

Gostaríamos de compartilhar uma informação importante sobre a empresa *{{nome_fantasia}}*.

Para mais detalhes, entre em contato conosco.

_iWof — Gestão Inteligente de Faturamento_',
    'COMUNICADO'
  )
ON CONFLICT (nome) DO NOTHING;
