-- Migration: cria o bucket e políticas de storage para anexos de ônus
-- Bucket: onus-anexos (privado, acesso público via URL pública)

-- 1. Cria o bucket se não existir
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'onus-anexos',
    'onus-anexos',
    true,                          -- público para leitura via URL
    10485760,                      -- 10 MB
    ARRAY[
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/jpg'
    ]
)
ON CONFLICT (id) DO NOTHING;

-- 2. Política: service role pode fazer upload (INSERT)
CREATE POLICY "service_role_upload_onus_anexos"
ON storage.objects
FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'onus-anexos');

-- 3. Política: qualquer um pode ler os arquivos (SELECT) via URL pública
CREATE POLICY "public_read_onus_anexos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'onus-anexos');

-- 4. Política: service role pode deletar (para limpeza futura)
CREATE POLICY "service_role_delete_onus_anexos"
ON storage.objects
FOR DELETE
TO service_role
USING (bucket_id = 'onus-anexos');
