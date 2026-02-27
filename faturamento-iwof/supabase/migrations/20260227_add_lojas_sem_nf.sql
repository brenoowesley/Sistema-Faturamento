ALTER TABLE faturamentos_lote ADD COLUMN IF NOT EXISTS lojas_sem_nf UUID[] DEFAULT ARRAY[]::UUID[];
