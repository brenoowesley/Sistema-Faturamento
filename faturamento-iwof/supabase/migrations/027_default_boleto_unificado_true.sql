-- Migration: 027_default_boleto_unificado_true.sql
-- Description: Sets the default value of the boleto_unificado column to true.
--              Clients will now have unified billing by default.

ALTER TABLE public.clientes
ALTER COLUMN boleto_unificado SET DEFAULT true;

-- Update existing clients if necessary?
-- The user didn't explicitly ask for this, but it's often implied.
-- However, we'll stick to new registrations for now.
