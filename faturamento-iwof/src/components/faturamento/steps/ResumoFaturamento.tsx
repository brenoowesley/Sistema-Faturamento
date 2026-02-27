"use client";

import { useMemo } from "react";
import { ArrowLeft, ChevronRight, DollarSign, Building2, CheckCircle2, AlertTriangle, AlertCircle, Users, XCircle, ChevronDown, Clock, ExternalLink, UserX, Plus } from "lucide-react";
import { FinancialSummary, ConciliationResult, Agendamento } from "../types";
import { fmtCurrency } from "../utils";

interface ResumoFaturamentoProps {
    setCurrentStep: (s: number) => void;
    financialSummary: FinancialSummary;
    conciliation: ConciliationResult;
    agendamentos: Agendamento[];
    duplicates: { identical: Agendamento[][], suspicious: Agendamento[][] };
}

export default function ResumoFaturamento({
    setCurrentStep,
    financialSummary,
    conciliation,
    agendamentos,
    duplicates
}: ResumoFaturamentoProps) {

    const totalFaturar = financialSummary.summaryArr.find(s => s.ciclo === "LÍQUIDO P/ LOTE")?.total || 0;
    const qtdEmpresas = financialSummary.summaryArr.find(s => s.ciclo === "LÍQUIDO P/ LOTE")?.empresasCount || 0;

    // Derived states for checklist
    const excluidos = agendamentos.filter(a => a.isRemoved).length;
    const foraPeriodo = agendamentos.filter(a => !a.isRemoved && a.status === "FORA_PERIODO").length;
    const ciclosIncorretos = agendamentos.filter(a => !a.isRemoved && a.status === "CICLO_INCORRETO").length;
    const correcoes = agendamentos.filter(a => !a.isRemoved && a.status === "CORREÇÃO").length;
    const divergentes = agendamentos.filter(a => !a.isRemoved && (a.status === "OK" || a.status === "CORREÇÃO") && !a.clienteId).length;

    const issues = [
        {
            title: "Lojas Sem Cadastro",
            count: conciliation.naoCadastrados.length,
            message: "Lojas na planilha sem paridade na base de clientes. Edite no cadastro do cliente se desejar incluir.",
            critical: true,
            icon: AlertCircle
        },
        {
            title: "Divergência de Nome Conta Azul",
            count: divergentes,
            message: "Lojas com pequenas divergências nominais e que não atrelaram CNPJ corretamente.",
            critical: true,
            icon: AlertTriangle
        },
        {
            title: "Duplicatas Idênticas Detectadas",
            count: duplicates.identical.length,
            message: "Linhas 100% idênticas foram auto-removidas para evitar dupla cobrança.",
            critical: false,
            icon: CheckCircle2
        },
        {
            title: "Fora de Período",
            count: foraPeriodo,
            message: "Agendamentos identificados com datas alheias ao escopo definido.",
            critical: false,
            icon: CheckCircle2
        },
        {
            title: "Ciclos Incorretos",
            count: ciclosIncorretos,
            message: "Lojas de outros ciclos de faturamento estão sendo ignoradas automaticamente.",
            critical: false,
            icon: CheckCircle2
        },
        {
            title: "Correções Pendentes (> 6 horas)",
            count: correcoes,
            message: "Agendamentos sugeridos a terem jornada reduzida para 6h.",
            critical: true,
            icon: AlertCircle
        }
    ];

    const hasBlockers = conciliation.naoCadastrados.length > 0 || divergentes > 0;

    return (
        <div className="flex flex-col gap-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-4">
                <button className="btn btn-ghost text-[var(--fg-dim)] hover:text-[var(--fg)]" onClick={() => setCurrentStep(1)}>
                    <ArrowLeft size={16} /> Voltar Setup
                </button>
                <button
                    className="btn btn-primary"
                    onClick={() => setCurrentStep(3)}
                    disabled={totalFaturar === 0}
                >
                    Avançar para Seleção Fiscal <ChevronRight size={16} />
                </button>
            </div>

            {/* ======== Novo Card de Resumo Global ======== */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="card" style={{ borderLeft: "3px solid #3b82f6" }}>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-dim)]">Empresas Faturadas (Validadas)</p>
                            <p className="text-2xl font-bold mt-1 text-[var(--fg)]">{financialSummary.globalFaturadas} <span className="text-sm font-normal text-[var(--fg-muted)]">CNPJs Únicos</span></p>
                        </div>
                        <CheckCircle2 size={32} className="text-[#3b82f6] opacity-30" />
                    </div>
                </div>
                <div className="card" style={{ borderLeft: "3px solid var(--danger)" }}>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-dim)]">Não Inclusas / Rejeitadas</p>
                            <p className="text-2xl font-bold mt-1 text-[var(--danger)]">{financialSummary.globalRejeitadas} <span className="text-sm font-normal text-[var(--fg-muted)]">CNPJs Únicos</span></p>
                        </div>
                        <XCircle size={32} className="text-[var(--danger)] opacity-30" />
                    </div>
                </div>
            </div>

            {/* ======== KPI Financial Cards ======== */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {financialSummary.summaryArr.map((fs) => (
                    <div
                        key={fs.ciclo}
                        className="card"
                        style={{
                            borderLeft:
                                fs.ciclo === "BRUTO ORIGINAL"
                                    ? "3px solid var(--accent)"
                                    : fs.ciclo === "FATURAMENTO GERAL (ARQUIVO)"
                                        ? "3px solid var(--accent)"
                                        : fs.ciclo === "EXCLUÍDOS"
                                            ? "3px solid var(--danger)"
                                            : fs.ciclo === "PENDENTES CORREÇÃO"
                                                ? "3px solid #f59e0b"
                                                : "3px solid #22c55e",
                        }}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-dim)]">
                                    {fs.ciclo}
                                </p>
                                <p
                                    className="text-xl font-bold mt-1"
                                    style={{
                                        color:
                                            fs.ciclo === "BRUTO ORIGINAL"
                                                ? "var(--accent)"
                                                : fs.ciclo === "EXCLUÍDOS"
                                                    ? "var(--danger)"
                                                    : fs.ciclo === "PENDENTES CORREÇÃO"
                                                        ? "#f59e0b"
                                                        : "#22c55e",
                                    }}
                                >
                                    {fmtCurrency(fs.total)}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1" style={{ color: "var(--fg-muted)" }}>
                                    {fs.empresasCount} {fs.empresasCount === 1 ? "empresa" : "empresas"}
                                </p>
                            </div>
                            <DollarSign
                                size={24}
                                style={{
                                    color:
                                        fs.ciclo === "BRUTO ORIGINAL"
                                            ? "var(--accent)"
                                            : fs.ciclo === "EXCLUÍDOS"
                                                ? "var(--danger)"
                                                : fs.ciclo === "PENDENTES CORREÇÃO"
                                                    ? "#f59e0b"
                                                    : "#22c55e",
                                    opacity: 0.4,
                                }}
                            />
                        </div>
                    </div>
                ))}
            </div>


            {/* KPI Section (Glassmorphism / Dark Sober) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-2">
                <div className="relative overflow-hidden group bg-gradient-to-br from-[var(--bg-sidebar)] to-[#0c1824] p-8 rounded-3xl border border-[var(--border)] shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
                    <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                        <DollarSign size={100} />
                    </div>
                    <div className="relative z-10">
                        <h3 className="text-sm font-bold text-[var(--accent)] uppercase tracking-widest mb-2 flex items-center gap-2">
                            <DollarSign size={16} /> Valor Líquido do Lote
                        </h3>
                        <p className="text-5xl font-black text-[var(--fg)]">{fmtCurrency(totalFaturar)}</p>
                        <p className="text-sm text-[var(--fg-muted)] mt-4">
                            Soma dos agendamentos válidos e dentro do ciclo selecionado.
                        </p>
                    </div>
                </div>

                <div className="relative overflow-hidden group bg-gradient-to-br from-[var(--bg-sidebar)] to-[#0a1f18] p-8 rounded-3xl border border-[var(--border)] shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
                    <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                        <Building2 size={100} />
                    </div>
                    <div className="relative z-10">
                        <h3 className="text-sm font-bold text-[var(--success)] uppercase tracking-widest mb-2 flex items-center gap-2">
                            <Building2 size={16} /> Lojas Participantes
                        </h3>
                        <p className="text-5xl font-black text-[var(--fg)]">{qtdEmpresas}</p>
                        <p className="text-sm text-[var(--fg-muted)] mt-4 flex items-center gap-4">
                            <span><Users size={14} className="inline mr-1" /> {agendamentos.filter(a => a.status === 'OK' && a.clienteId && !a.isRemoved).length} agendamentos válidos</span>
                            <span className="text-[var(--danger)]">{excluidos} excluídos</span>
                        </p>
                    </div>
                </div>
            </div>

            {/* Checklist Section */}
            <div className="bg-[var(--bg-sidebar)] border border-[var(--border)] rounded-2xl overflow-hidden mt-6">
                <div className="px-6 py-5 border-b border-[var(--border)] bg-[rgba(0,0,0,0.2)]">
                    <h3 className="text-lg font-bold text-[var(--fg)]">Checklist de Integridade</h3>
                    <p className="text-sm text-[var(--fg-dim)] mt-1">
                        Revisão automática dos dados cruzados entre a planilha e o banco de dados.
                        Itens em vermelho exigem atenção se não quiser pular faturamentos.
                    </p>
                </div>

                <div className="divide-y divide-[var(--border)]">
                    {issues.map((issue, idx) => {
                        const Icon = issue.icon;
                        const hasItems = issue.count > 0;
                        const colorClass = hasItems
                            ? (issue.critical ? "text-[var(--danger)]" : "text-amber-500")
                            : "text-[var(--success)]";
                        const bgClass = hasItems
                            ? (issue.critical ? "bg-[rgba(239,68,68,0.1)]" : "bg-amber-500/10")
                            : "bg-[rgba(34,197,94,0.1)]";
                        const borderLeft = hasItems
                            ? (issue.critical ? "border-l-4 border-l-[var(--danger)]" : "border-l-4 border-l-amber-500")
                            : "border-l-4 border-l-[var(--success)]";

                        return (
                            <div key={idx} className={`p-5 flex items-start gap-4 ${borderLeft} hover:bg-[var(--bg-card-hover)] transition-colors`}>
                                <div className={`p-2 rounded-xl ${bgClass}`}>
                                    <Icon size={20} className={colorClass} />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between">
                                        <h4 className="font-bold text-[var(--fg)]">{issue.title}</h4>
                                        <span className={`font-mono font-bold text-sm bg-[var(--bg-card)] px-3 py-1 rounded-lg border border-[var(--border)] ${hasItems ? (issue.critical ? "text-[var(--danger)]" : "text-[var(--fg)]") : "text-[var(--fg-dim)]"}`}>
                                            {issue.count} registros
                                        </span>
                                    </div>
                                    <p className="text-sm text-[var(--fg-dim)] mt-1">
                                        {hasItems ? issue.message : "Nenhuma anomalia detectada nesta categoria."}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {hasBlockers && (
                <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl flex items-start gap-3 mt-2 text-sm text-amber-200/90">
                    <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                    <div>
                        <strong className="block text-amber-500 mb-1">Deseja prosseguir mesmo assim?</strong>
                        Notamos que existem notas críticas (Lojas sem cadastro ou CNPJ). Se você avançar, os agendamentos dessas empresas <strong>não serão computados</strong> no lote. Recomendamos corrigir os Nomes no módulo Clientes e re-importar a planilha se de fato quiser incluí-las.
                    </div>
                </div>
            )}
        </div>
    );
}

