-- Create Ajustes Faturamento Table
CREATE TABLE IF NOT EXISTS ajustes_faturamento (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    cliente_id UUID REFERENCES clientes(id) ON DELETE CASCADE,
    tipo VARCHAR(20) CHECK (tipo IN ('DESCONTO', 'ACRESCIMO')),
    valor NUMERIC(10, 2) NOT NULL,
    motivo TEXT,
    nome_profissional VARCHAR(255),
    data_ocorrencia DATE NOT NULL,
    status_aplicacao BOOLEAN DEFAULT false,
    data_aplicacao DATE,
    lote_aplicado_id UUID,
    
    -- Columns for Acréscimos (Manual Appointments)
    inicio TIMESTAMP WITH TIME ZONE,
    termino TIMESTAMP WITH TIME ZONE,
    fracao_hora NUMERIC(10, 2),
    
    detalhes_extras JSONB DEFAULT '{}'::jsonb
);

-- Enable RLS
ALTER TABLE ajustes_faturamento ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write for now (as per project patterns seen in 003_rls_allow_anon.sql)
CREATE POLICY "Allow anon access to ajustes" ON ajustes_faturamento
FOR ALL USING (true) WITH CHECK (true);
