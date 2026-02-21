-- migração 015: Backfill de Perfis e Garantia de ADMIN inicial
-- Garante que todos os usuários existentes no auth.users tenham uma entrada em usuarios_perfis
INSERT INTO public.usuarios_perfis (id, email, nome, cargo)
SELECT 
    id, 
    email, 
    COALESCE(raw_user_meta_data->>'nome', split_part(email, '@', 1)),
    'USER'
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- Garante que o Breno seja ADMIN especificamente
UPDATE public.usuarios_perfis 
SET cargo = 'ADMIN' 
WHERE email = 'breno@iwof.com.br';
