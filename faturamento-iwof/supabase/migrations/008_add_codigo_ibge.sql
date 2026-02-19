
-- Migration 008: Adicionar código IBGE aos clientes
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS codigo_ibge VARCHAR(10);
