-- ============================================================
-- MIGRATION 002: Expandir tabela clientes com novos campos
-- Data: 2026-02-18
-- Descrição: Remove endereco_completo (jsonb) e adiciona
--            campos separados para endereço, contato e dados
--            operacionais.
-- ============================================================

-- 1. Remover coluna antiga de endereço compactado
ALTER TABLE clientes DROP COLUMN IF EXISTS endereco_completo;

-- 2. Adicionar novos campos
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS nome                VARCHAR(255);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cpf                 VARCHAR(14);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS id_estrangeiro      VARCHAR(50);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS data_criacao        DATE;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS observacoes         TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS codigo              VARCHAR(50);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email_principal     VARCHAR(255);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS telefone_principal  VARCHAR(30);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS data_fundacao       DATE;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cep                 VARCHAR(10);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS estado              VARCHAR(2);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cidade              VARCHAR(150);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS endereco            VARCHAR(255);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS numero              VARCHAR(20);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS bairro              VARCHAR(150);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS complemento         VARCHAR(255);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS nome_contato        VARCHAR(255);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email_contato       VARCHAR(255);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS nome_conta_azul     VARCHAR(255);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS boleto_unificado    BOOLEAN DEFAULT false;
