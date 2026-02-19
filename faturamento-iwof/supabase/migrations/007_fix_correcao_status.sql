-- Migration: 007_fix_correcao_status.sql
-- Description: Fixes retroactive data discrepancy where 'CORREÇÃO' items were ignored by Fechamento.
--              Updates 'CORREÇÃO' items to 'VALIDADO' and caps their value at 6 hours.

-- 1. Update items that are marked as 'CORREÇÃO' and have duration > 6h
UPDATE agendamentos_brutos
SET 
  -- Cap the value: (original_value / original_duration) * 6
  valor_iwof = CASE 
      WHEN fracao_hora > 0 THEN ROUND((valor_iwof / fracao_hora) * 6, 2)
      ELSE valor_iwof 
  END,
  -- Cap the duration at 6h
  fracao_hora = 6,
  -- Mark as VALIDADO so they appear in Fechamento
  status_validacao = 'VALIDADO'
WHERE 
  status_validacao = 'CORREÇÃO' 
  AND fracao_hora > 6;
