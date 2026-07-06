-- Tabela para guardar os lotes mestres exportados/salvos
CREATE TABLE lotes_parciais (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    nome_arquivo VARCHAR(255),
    total_nfs NUMERIC(10, 2) DEFAULT 0,
    total_ncs NUMERIC(10, 2) DEFAULT 0,
    qtd_itens INTEGER DEFAULT 0,
    notas TEXT
);

-- Tabela para guardar os lançamentos de cada lote
CREATE TABLE lancamentos_parciais_itens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lote_id UUID REFERENCES lotes_parciais(id) ON DELETE CASCADE,
    pedido VARCHAR(255),
    tipo VARCHAR(50), -- 'NF' ou 'NC'
    descricao TEXT,
    valor NUMERIC(10, 2) DEFAULT 0,
    cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
    loja_nome_sugerido VARCHAR(255),
    cnpj VARCHAR(20),
    periodo_servico VARCHAR(255),
    numero_nf_gerada VARCHAR(100),
    irrf NUMERIC(10, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitação RLS
ALTER TABLE lotes_parciais ENABLE ROW LEVEL SECURITY;
ALTER TABLE lancamentos_parciais_itens ENABLE ROW LEVEL SECURITY;

-- Políticas permissivas (pois sistema interno)
CREATE POLICY "Enable all for lotes_parciais" ON lotes_parciais FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all for lancamentos_parciais_itens" ON lancamentos_parciais_itens FOR ALL USING (true) WITH CHECK (true);
