-- Migration 042: Adiciona canal_recebimento à tabela ajustes_faturamento
-- Canal pelo qual o ônus/acréscimo foi recebido: tasky, email, whatsapp
-- WhatsApp permitido apenas para lojas do ciclo Nordestão (validação no frontend)

ALTER TABLE ajustes_faturamento
    ADD COLUMN IF NOT EXISTS canal_recebimento VARCHAR(20)
        CHECK (canal_recebimento IN ('tasky', 'email', 'whatsapp'));
