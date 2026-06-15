-- Migration 044: adiciona suporte a anexo de termo assinado nos ajustes
-- Coluna na tabela + bucket de storage para os arquivos

-- 1. Adiciona a coluna anexo_url em ajustes_faturamento (se não existir)
ALTER TABLE ajustes_faturamento
    ADD COLUMN IF NOT EXISTS anexo_url TEXT DEFAULT NULL;

COMMENT ON COLUMN ajustes_faturamento.anexo_url IS
    'URL pública do termo assinado armazenado no bucket ajustes-anexos';

-- 2. Cria o bucket ajustes-anexos (público para leitura via URL)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'ajustes-anexos',
    'ajustes-anexos',
    true,                           -- público para leitura via URL
    10485760,                       -- 10 MB
    ARRAY[
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/jpg'
    ]
)
ON CONFLICT (id) DO NOTHING;

-- 3. Política: usuários autenticados podem fazer upload (INSERT)
CREATE POLICY "authenticated_upload_ajustes_anexos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'ajustes-anexos');

-- 4. Política: qualquer um pode ler os arquivos (SELECT) via URL pública
CREATE POLICY "public_read_ajustes_anexos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'ajustes-anexos');

-- 5. Política: usuários autenticados podem deletar os próprios arquivos
CREATE POLICY "authenticated_delete_ajustes_anexos"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'ajustes-anexos');
