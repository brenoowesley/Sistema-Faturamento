-- ============================================================
-- 028: Tabela para armazenar tokens OAuth2 do Conta Azul
-- ============================================================

CREATE TABLE IF NOT EXISTS conta_azul_tokens (
    id          TEXT PRIMARY KEY DEFAULT 'padrao',
    refresh_token TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: Apenas o service_role pode ler/gravar (API routes server-side)
ALTER TABLE conta_azul_tokens ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy para anon/authenticated = acesso bloqueado no client-side
-- Apenas o supabaseAdmin (service_role_key) consegue operar nesta tabela
