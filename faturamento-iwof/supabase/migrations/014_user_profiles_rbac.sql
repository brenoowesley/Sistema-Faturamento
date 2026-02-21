-- migração 014: Perfis de Usuário e RBAC
-- Tabela de perfis para estender auth.users
CREATE TABLE IF NOT EXISTS public.usuarios_perfis (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    nome TEXT,
    cargo TEXT DEFAULT 'USER' CHECK (cargo IN ('ADMIN', 'USER')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ativar RLS
ALTER TABLE public.usuarios_perfis ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
-- 1. Qualquer usuário autenticado pode ler os perfis (necessário para a sidebar/verificação de cargo)
CREATE POLICY "Qualquer autenticado pode ler perfis" 
ON public.usuarios_perfis FOR SELECT 
TO authenticated 
USING (true);

-- 2. O usuário pode atualizar seu próprio nome e email (mas não o cargo, a menos que seja admin)
CREATE POLICY "Usuário pode atualizar seu próprio perfil" 
ON public.usuarios_perfis FOR UPDATE 
TO authenticated 
USING (auth.uid() = id)
WITH CHECK (
    auth.uid() = id AND 
    (
        -- Se não for admin, não pode mudar o cargo
        CASE 
            WHEN (SELECT cargo FROM public.usuarios_perfis WHERE id = auth.uid()) != 'ADMIN' 
            THEN cargo = (SELECT cargo FROM public.usuarios_perfis WHERE id = auth.uid())
            ELSE true
        END
    )
);

-- 3. Apenas administradores podem inserir ou deletar perfis (embora isso seja feito via trigger/admin api)
CREATE POLICY "Admins podem tudo" 
ON public.usuarios_perfis FOR ALL 
TO authenticated 
USING ((SELECT cargo FROM public.usuarios_perfis WHERE id = auth.uid()) = 'ADMIN');

-- Função para criar perfil automaticamente no signup
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.usuarios_perfis (id, email, nome)
    VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'nome');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger no auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Definir ADMIN inicial
DO $$
BEGIN
    -- Se o perfil já existir, atualiza para ADMIN
    IF EXISTS (SELECT 1 FROM public.usuarios_perfis WHERE email = 'breno@iwof.com.br') THEN
        UPDATE public.usuarios_perfis SET cargo = 'ADMIN' WHERE email = 'breno@iwof.com.br';
    END IF;
END $$;
