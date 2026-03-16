-- Migração 024: Restrição de Acesso para Perfil CX (Customer Experience)
-- Este script define políticas de RLS mais granulares para proteger o sistema de faturamento.

-- 1. Atualizar o Check Constraint da tabela de perfis para aceitar 'CX'
-- Primeiro removemos o antigo e adicionamos o novo
ALTER TABLE public.usuarios_perfis DROP CONSTRAINT IF EXISTS usuarios_perfis_cargo_check;
ALTER TABLE public.usuarios_perfis ADD CONSTRAINT usuarios_perfis_cargo_check CHECK (cargo IN ('ADMIN', 'USER', 'CX'));

-- 2. Função auxiliar para obter o cargo do usuário autenticado de forma performática
-- Usamos SECURITY DEFINER para que a função possa ler a tabela de perfis independente da RLS da própria tabela
CREATE OR REPLACE FUNCTION public.get_my_cargo()
RETURNS TEXT AS $$
  SELECT cargo FROM public.usuarios_perfis WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- 3. Habilitar RLS nas tabelas de saques (Transfeera) se não estiverem
ALTER TABLE public.lotes_saques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itens_saque ENABLE ROW LEVEL SECURITY;

-- 4. Limpeza de políticas genéricas e permissivas (Authenticated USING true)
-- Clientes
DROP POLICY IF EXISTS "Authenticated users can manage clientes" ON clientes;
DROP POLICY IF EXISTS "Authenticated full access on clientes" ON clientes;

-- Ciclos
DROP POLICY IF EXISTS "Authenticated users can manage ciclos" ON ciclos_faturamento;
DROP POLICY IF EXISTS "Authenticated full access on ciclos_faturamento" ON ciclos_faturamento;

-- Lotes
DROP POLICY IF EXISTS "Authenticated users can manage lotes" ON faturamentos_lote;
DROP POLICY IF EXISTS "Authenticated full access on faturamentos_lote" ON faturamentos_lote;

-- Agendamentos
DROP POLICY IF EXISTS "Authenticated users can manage agendamentos" ON agendamentos_brutos;
DROP POLICY IF EXISTS "Authenticated full access on agendamentos_brutos" ON agendamentos_brutos;

-- Ajustes
DROP POLICY IF EXISTS "Authenticated users can manage ajustes" ON ajustes_faturamento;
DROP POLICY IF EXISTS "Authenticated full access on ajustes_faturamento" ON ajustes_faturamento;

-- Consolidados
DROP POLICY IF EXISTS "Authenticated users can manage consolidados" ON faturamento_consolidados;
DROP POLICY IF EXISTS "Authenticated full access on faturamento_consolidados" ON faturamento_consolidados;

-- Saques
DROP POLICY IF EXISTS "Allow all access on lotes_saques" ON lotes_saques;
DROP POLICY IF EXISTS "Allow all access on itens_saque" ON itens_saque;


-- 5. Criação de Novas Políticas Baseadas em Cargo

-- TABELAS DE FATURAMENTO (Apenas ADMIN e USER)
-- Clientes
CREATE POLICY "Admin/User podem gerenciar clientes" ON clientes 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER'));

-- Ciclos
CREATE POLICY "Admin/User podem gerenciar ciclos" ON ciclos_faturamento 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER'));

-- Lotes
CREATE POLICY "Admin/User podem gerenciar lotes" ON faturamentos_lote 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER'));

-- Agendamentos
CREATE POLICY "Admin/User podem gerenciar agendamentos" ON agendamentos_brutos 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER'));

-- Ajustes
CREATE POLICY "Admin/User podem gerenciar ajustes" ON ajustes_faturamento 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER'));

-- Consolidados
CREATE POLICY "Admin/User podem gerenciar consolidados" ON faturamento_consolidados 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER'));


-- TABELAS DE SAQUES (ADMIN/USER total, CX SELECT apenas)
-- Lotes Saques
CREATE POLICY "Admin/User total access on lotes_saques" ON lotes_saques 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER'));

CREATE POLICY "CX select access on lotes_saques" ON lotes_saques 
FOR SELECT TO authenticated USING (get_my_cargo() = 'CX');

-- Itens Saque
CREATE POLICY "Admin/User total access on itens_saque" ON itens_saque 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER'));

CREATE POLICY "CX select access on itens_saque" ON itens_saque 
FOR SELECT TO authenticated USING (get_my_cargo() = 'CX');
