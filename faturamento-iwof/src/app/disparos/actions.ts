"use server";

import { createClient } from "@/lib/supabase/server";

/* ================================================================
   TYPES
   ================================================================ */

export interface ContatoInput {
  cnpj: string;
  telefone: string;
}

export interface ContatoProcessado {
  cnpj: string;
  telefone: string;
  clienteId: string | null;
  nomeFantasia: string;
  razaoSocial: string;
  primeiroNome: string;
  emailPrincipal: string;
  telefoneBanco: string;
  divergentPhone: boolean;
  encontradoNoBanco: boolean;
  possuiFaturaNoLote: boolean;
  valorTotal: number;
  vencimento: string;
}

export interface ProcessarContatosResult {
  destinatarios: ContatoProcessado[];
  ignorados: ContatoProcessado[];
  totalEncontrados: number;
  totalIgnorados: number;
  nomeLote: string;
}

/* ================================================================
   SERVER ACTION: processarContatos
   ================================================================ */

export async function processarContatos(
  contatos: ContatoInput[],
  loteId: string | null
): Promise<ProcessarContatosResult> {
  const supabase = await createClient();

  // 1. Buscar todos os clientes pelo CNPJ
  const cnpjs = contatos.map((c) => c.cnpj.replace(/\D/g, ""));
  const cnpjsFormatted = contatos.map((c) => {
    const raw = c.cnpj.replace(/\D/g, "");
    // Tenta match tanto formatado quanto raw
    return raw;
  });

  const { data: clientes, error: clienteErr } = await supabase
    .from("clientes")
    .select("id, cnpj, razao_social, nome_fantasia, nome, telefone_principal, email_principal, tempo_pagamento_dias")
    .in("cnpj", [
      ...cnpjsFormatted,
      // Também busca com formatação XX.XXX.XXX/XXXX-XX
      ...cnpjsFormatted.map(formatCNPJ),
    ]);

  if (clienteErr) {
    throw new Error(`Erro ao buscar clientes: ${clienteErr.message}`);
  }

  // Mapa de CNPJ (sem formatação) -> cliente
  const clienteMap = new Map<string, (typeof clientes)[number]>();
  (clientes || []).forEach((c) => {
    const rawCnpj = c.cnpj.replace(/\D/g, "");
    clienteMap.set(rawCnpj, c);
  });

  // 2. Se temos loteId, buscar consolidados para verificar intersecção
  let consolidadoMap = new Map<string, { valorBoleto: number; vencimento: string }>();
  let nomeLote = "";

  if (loteId) {
    // Buscar nome do lote
    const { data: loteData } = await supabase
      .from("faturamentos_lote")
      .select("nome_pasta, data_competencia")
      .eq("id", loteId)
      .single();

    nomeLote = loteData?.nome_pasta || `Lote ${loteId.slice(0, 8)}`;

    // Buscar consolidados desse lote
    const { data: consolidados } = await supabase
      .from("faturamento_consolidados")
      .select("cliente_id, valor_boleto_final, clientes(cnpj, tempo_pagamento_dias)")
      .eq("lote_id", loteId);

    (consolidados || []).forEach((c: any) => {
      const cliente = Array.isArray(c.clientes) ? c.clientes[0] : c.clientes;
      if (cliente) {
        const rawCnpj = cliente.cnpj.replace(/\D/g, "");
        // Calcular vencimento: hoje + tempo_pagamento_dias
        const prazo = cliente.tempo_pagamento_dias || 30;
        const venc = new Date();
        venc.setDate(venc.getDate() + prazo);
        const vencFmt = venc.toLocaleDateString("pt-BR");

        consolidadoMap.set(rawCnpj, {
          valorBoleto: Number(c.valor_boleto_final || 0),
          vencimento: vencFmt,
        });
      }
    });
  }

  // 3. Processar cada contato
  const destinatarios: ContatoProcessado[] = [];
  const ignorados: ContatoProcessado[] = [];

  for (const contato of contatos) {
    const rawCnpj = contato.cnpj.replace(/\D/g, "");
    const cliente = clienteMap.get(rawCnpj);

    const telefoneBanco = cliente?.telefone_principal || "";
    const telefoneInput = contato.telefone.replace(/\D/g, "");
    const telefoneBancoRaw = telefoneBanco.replace(/\D/g, "");

    const divergentPhone =
      !!telefoneBancoRaw &&
      !!telefoneInput &&
      telefoneBancoRaw !== telefoneInput;

    // Telefone final: prioriza XLSX, senão usa o do banco
    const telefoneFinal = telefoneInput || telefoneBancoRaw;

    // Extrair primeiro nome
    const nomeCompleto = cliente?.nome || cliente?.nome_fantasia || cliente?.razao_social || "";
    const primeiroNome = nomeCompleto.split(" ")[0];

    // Dados do consolidado (se lote selecionado)
    const consolData = consolidadoMap.get(rawCnpj);
    const possuiFaturaNoLote = loteId ? !!consolData : true;

    const processado: ContatoProcessado = {
      cnpj: rawCnpj,
      telefone: telefoneFinal,
      clienteId: cliente?.id || null,
      nomeFantasia: cliente?.nome_fantasia || "",
      razaoSocial: cliente?.razao_social || "",
      primeiroNome,
      emailPrincipal: cliente?.email_principal || "",
      telefoneBanco: telefoneBancoRaw,
      divergentPhone,
      encontradoNoBanco: !!cliente,
      possuiFaturaNoLote,
      valorTotal: consolData?.valorBoleto || 0,
      vencimento: consolData?.vencimento || "",
    };

    // Se loteId foi selecionado, só inclui quem tem fatura no lote
    if (loteId && !possuiFaturaNoLote) {
      ignorados.push(processado);
    } else if (!telefoneFinal) {
      // Sem telefone = ignorado
      ignorados.push(processado);
    } else {
      destinatarios.push(processado);
    }
  }

  return {
    destinatarios,
    ignorados,
    totalEncontrados: destinatarios.length,
    totalIgnorados: ignorados.length,
    nomeLote,
  };
}

/* ================================================================
   SERVER ACTION: buscarContatosDoBanco
   ================================================================ */

export async function buscarContatosDoBanco(
  busca: string
): Promise<ContatoInput[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("clientes")
    .select("cnpj, telefone_principal, razao_social, nome_fantasia")
    .or(`razao_social.ilike.%${busca}%,nome_fantasia.ilike.%${busca}%,cnpj.ilike.%${busca}%`)
    .eq("status", true)
    .limit(50);

  if (error) throw new Error(`Erro ao buscar contatos: ${error.message}`);

  return (data || [])
    .filter((c) => c.telefone_principal)
    .map((c) => ({
      cnpj: c.cnpj,
      telefone: c.telefone_principal!,
    }));
}

/* ================================================================
   SERVER ACTION: buscarLotes
   ================================================================ */

export async function buscarLotes() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("faturamentos_lote")
    .select("id, nome_pasta, data_competencia, data_inicio_ciclo, data_fim_ciclo, status")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) throw new Error(`Erro ao buscar lotes: ${error.message}`);
  return data || [];
}

/* ================================================================
   UTIL
   ================================================================ */

function formatCNPJ(raw: string): string {
  if (raw.length !== 14) return raw;
  return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`;
}
