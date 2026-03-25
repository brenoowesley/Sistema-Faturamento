-- Migração 025: Adicionar Perfil APROVADOR e atualizar permissões
-- Este script permite o novo cargo 'APROVADOR' no sistema e concede permissões para gestão de saques.

-- 1. Atualizar o Check Constraint da tabela de perfis para aceitar 'APROVADOR'
ALTER TABLE public.usuarios_perfis DROP CONSTRAINT IF EXISTS usuarios_perfis_cargo_check;
ALTER TABLE public.usuarios_perfis ADD CONSTRAINT usuarios_perfis_cargo_check CHECK (cargo IN ('ADMIN', 'USER', 'CX', 'APROVADOR'));

-- 2. Atualizar políticas de RLS para Saques (Permitir APROVADOR)
-- Lotes Saques
DROP POLICY IF EXISTS "Admin/User total access on lotes_saques" ON lotes_saques;
CREATE POLICY "Admin/User/Aprovador total access on lotes_saques" ON lotes_saques 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER', 'APROVADOR'));

-- Itens Saque
DROP POLICY IF EXISTS "Admin/User total access on itens_saque" ON itens_saque;
CREATE POLICY "Admin/User/Aprovador total access on itens_saque" ON itens_saque 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER', 'APROVADOR'));

-- 3. Permitir que APROVADOR também veja Clientes e Faturamentos (necessário para contextualizar saques)
DROP POLICY IF EXISTS "Admin/User podem gerenciar clientes" ON clientes;
CREATE POLICY "Admin/User/Aprovador podem gerenciar clientes" ON clientes 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER', 'APROVADOR'));

DROP POLICY IF EXISTS "Admin/User podem gerenciar ciclos" ON ciclos_faturamento;
CREATE POLICY "Admin/User/Aprovador podem gerenciar ciclos" ON ciclos_faturamento 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER', 'APROVADOR'));

DROP POLICY IF EXISTS "Admin/User podem gerenciar lotes" ON faturamentos_lote;
CREATE POLICY "Admin/User/Aprovador podem gerenciar lotes" ON faturamentos_lote 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER', 'APROVADOR'));

DROP POLICY IF EXISTS "Admin/User podem gerenciar agendamentos" ON agendamentos_brutos;
CREATE POLICY "Admin/User/Aprovador podem gerenciar agendamentos" ON agendamentos_brutos 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER', 'APROVADOR'));

DROP POLICY IF EXISTS "Admin/User podem gerenciar ajustes" ON ajustes_faturamento;
CREATE POLICY "Admin/User/Aprovador podem gerenciar ajustes" ON ajustes_faturamento 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER', 'APROVADOR'));

DROP POLICY IF EXISTS "Admin/User podem gerenciar consolidados" ON faturamento_consolidados;
CREATE POLICY "Admin/User/Aprovador podem gerenciar consolidados" ON faturamento_consolidados 
FOR ALL TO authenticated USING (get_my_cargo() IN ('ADMIN', 'USER', 'APROVADOR'));
