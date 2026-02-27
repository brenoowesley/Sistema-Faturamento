export interface Ciclo {
    id: string;
    nome: string;
}

export interface ClienteDB {
    id: string;
    razao_social: string;
    nome_fantasia: string | null;
    nome: string | null;
    nome_conta_azul: string | null;
    cnpj: string;
    cep?: string | null;
    endereco?: string | null;
    numero?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
    ciclo_faturamento_id: string | null;
    ciclos_faturamento?: { nome: string } | null;
    status: boolean;
}

export type ValidationStatus = "OK" | "CANCELAR" | "CORREÇÃO" | "FORA_PERIODO" | "DUPLICATA" | "EXCLUIDO" | "CICLO_INCORRETO" | "AUDITORIA_FINANCEIRA";

export interface Agendamento {
    id: string;
    nome: string;
    telefone: string;
    estado: string;
    loja: string;
    vaga: string;
    inicio: Date | null;
    termino: Date | null;
    refAgendamento: string;
    agendadoEm: Date | null;
    iniciadoEm: Date | null;
    concluidoEm: Date | null;
    valorIwof: number;
    fracaoHora: number;
    statusAgendamento: string;
    dataCancelamento: Date | null;
    motivoCancelamento: string;
    responsavelCancelamento: string;

    // Processed fields
    status: ValidationStatus;
    clienteId: string | null;      // matched DB client id
    razaoSocial?: string | null;
    cnpj?: string | null;
    cicloNome: string | null;      // from DB join
    rawRow: Record<string, string>;

    // Interactive fields
    isRemoved?: boolean;
    manualValue?: number;
    exclusionReason?: string;

    // Suggestion fields (for CORREÇÃO items > 6h)
    suggestedFracaoHora?: number;
    suggestedValorIwof?: number;
    suggestedTermino?: Date | null;
    originalFracaoHora?: number;
    originalValorIwof?: number;
    originalTermino?: Date | null;
    suggestedClients?: ClienteDB[];
}

export interface ConciliationResult {
    naoCadastrados: { loja: string; cnpj: string; suggestions?: ClienteDB[] }[];
    ausentesNoLote: ClienteDB[];
}

export type ResultTab = "validacoes" | "duplicatas" | "conciliacao" | "validados" | "excluidos" | "ciclos" | "divergentes";

export interface FinancialSummaryItem {
    ciclo: string;
    total: number;
    empresasCount: number;
}

export interface FinancialSummary {
    summaryArr: FinancialSummaryItem[];
    globalFaturadas: number;
    globalRejeitadas: number;
}
