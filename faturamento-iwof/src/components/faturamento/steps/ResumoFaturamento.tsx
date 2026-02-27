"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, DollarSign, Building2, CheckCircle2, AlertTriangle, AlertCircle, Users, XCircle, ChevronDown } from "lucide-react";
import { FinancialSummary, ConciliationResult, Agendamento } from "../types";
import { fmtCurrency } from "../utils";

interface ResumoFaturamentoProps {
    setCurrentStep: (s: number) => void;
    financialSummary: FinancialSummary;
    conciliation: ConciliationResult;
    agendamentos: Agendamento[];
    setAgendamentos: React.Dispatch<React.SetStateAction<Agendamento[]>>;
    duplicates: { identical: Agendamento[][], suspicious: Agendamento[][] };
}

export default function ResumoFaturamento({
    setCurrentStep,
    financialSummary,
    conciliation,
    agendamentos,
    setAgendamentos,
    duplicates
}: ResumoFaturamentoProps) {

    const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

    const toggleCategory = (title: string) => {
        setOpenCategories(prev => ({ ...prev, [title]: !prev[title] }));
    };

    const handleActionItem = (id: string, actionDesc: "REMOVE" | "RESTORE" | "APPROVE", suggestedVal?: number) => {
        setAgendamentos(prev => prev.map(a => {
            if (a.id !== id) return a;

            if (actionDesc === "REMOVE") {
                return { ...a, isRemoved: true };
            }
            if (actionDesc === "RESTORE") {
                return { ...a, isRemoved: false, status: "OK" };
            }
            if (actionDesc === "APPROVE") {
                return { ...a, isRemoved: false, status: "OK", manualValue: suggestedVal ?? a.valorIwof, fracaoHora: a.suggestedFracaoHora ?? a.fracaoHora };
            }
            return a;
        }));
    };

    const totalFaturar = financialSummary.summaryArr.find(s => s.ciclo === "LÍQUIDO P/ LOTE")?.total || 0;
    const qtdEmpresas = financialSummary.summaryArr.find(s => s.ciclo === "LÍQUIDO P/ LOTE")?.empresasCount || 0;

    // Derived states for checklist
    const excluidos = agendamentos.filter(a => a.isRemoved).length;

    // Derived values for lists
    const listForaPeriodo = agendamentos.filter(a => !a.isRemoved && a.status === "FORA_PERIODO");
    const listCiclosIncorretos = agendamentos.filter(a => !a.isRemoved && a.status === "CICLO_INCORRETO");
    const listCorrecoes = agendamentos.filter(a => !a.isRemoved && a.status === "CORREÇÃO");
    const listSubMiny = agendamentos.filter(a => !a.isRemoved && a.status === "CANCELAR");
    const listDivergentes = agendamentos.filter(a => !a.isRemoved && (a.status === "OK" || a.status === "CORREÇÃO") && !a.clienteId);

    const issues = [
        {
            title: "Lojas Sem Cadastro / Divergentes",
            count: conciliation.naoCadastrados.length + listDivergentes.length,
            message: "Lojas na planilha sem paridade na base de clientes. Edite no cadastro do cliente se desejar incluir.",
            critical: true,
            icon: AlertCircle,
            items: [] // handled in tables
        },
        {
            title: "Sessões Irrelevantes (< 0.16h)",
            count: listSubMiny.length,
            message: "Agendamentos curtíssimos marcados para Cancelamento. Você pode confirmar a remoção ou forçar faturamento.",
            critical: false,
            icon: AlertTriangle,
            items: listSubMiny
        },
        {
            title: "Fora de Período",
            count: listForaPeriodo.length,
            message: "Agendamentos identificados com datas alheias ao escopo definido.",
            critical: false,
            icon: CheckCircle2,
            items: listForaPeriodo
        },
        {
            title: "Ciclos Incorretos",
            count: listCiclosIncorretos.length,
            message: "Lojas de outros ciclos de faturamento estão sendo ignoradas automaticamente.",
            critical: false,
            icon: CheckCircle2,
            items: listCiclosIncorretos
        },
        {
            title: "Correções Pendentes (> 6 horas)",
            count: listCorrecoes.length,
            message: "Agendamentos sugeridos a terem jornada reduzida para 6h.",
            critical: true,
            icon: AlertCircle,
            items: listCorrecoes
        }
    ];

    const hasBlockers = conciliation.naoCadastrados.length > 0 || listDivergentes.length > 0;

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

                        const isOpen = openCategories[issue.title];

                        return (
                            <div key={idx} className={`flex flex-col ${borderLeft} transition-colors`}>
                                {/* Header Toggle */}
                                <div
                                    className={`p-5 flex items-start gap-4 hover:bg-[var(--bg-card-hover)] cursor-pointer select-none transition-colors ${isOpen ? 'bg-[rgba(0,0,0,0.1)]' : ''}`}
                                    onClick={() => hasItems && issue.items.length > 0 && toggleCategory(issue.title)}
                                >
                                    <div className={`p-2 rounded-xl ${bgClass}`}>
                                        <Icon size={20} className={colorClass} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between">
                                            <h4 className="font-bold text-[var(--fg)]">{issue.title}</h4>
                                            <div className="flex items-center gap-3">
                                                <span className={`font-mono font-bold text-sm bg-[var(--bg-card)] px-3 py-1 rounded-lg border border-[var(--border)] ${hasItems ? (issue.critical ? "text-[var(--danger)]" : "text-[var(--fg)]") : "text-[var(--fg-dim)]"}`}>
                                                    {issue.count} registros
                                                </span>
                                                {hasItems && issue.items.length > 0 && (
                                                    <ChevronDown size={18} className={`text-[var(--fg-dim)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                                )}
                                            </div>
                                        </div>
                                        <p className="text-sm text-[var(--fg-dim)] mt-1">
                                            {hasItems ? issue.message : "Nenhuma anomalia detectada nesta categoria."}
                                        </p>
                                    </div>
                                </div>

                                {/* Expanded Content */}
                                {isOpen && hasItems && issue.items.length > 0 && (
                                    <div className="bg-[var(--bg-card)] border-t border-[var(--border)] p-4 max-h-[400px] overflow-y-auto">
                                        <div className="space-y-3">
                                            {issue.items.map(a => (
                                                <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[rgba(255,255,255,0.02)]">
                                                    <div>
                                                        <p className="text-sm font-bold text-[var(--fg)]">{a.loja} <span className="text-xs font-normal text-[var(--fg-muted)]">({a.nome})</span></p>
                                                        <p className="text-xs text-[var(--fg-dim)] mt-1">
                                                            {a.inicio?.toLocaleDateString("pt-BR")} | {a.fracaoHora}h | <span className="font-mono">{fmtCurrency(a.valorIwof)}</span>
                                                        </p>
                                                    </div>

                                                    <div className="flex gap-2">
                                                        {issue.title.includes("Correções") ? (
                                                            <>
                                                                <button className="btn btn-sm btn-ghost text-[var(--danger)] text-xs" onClick={() => handleActionItem(a.id, "REMOVE")}>Remover</button>
                                                                <button className="btn btn-sm bg-[var(--accent)] text-white text-xs border-none" onClick={() => handleActionItem(a.id, "APPROVE", a.suggestedValorIwof)}>Aprovar ({fmtCurrency(a.suggestedValorIwof || 0)})</button>
                                                            </>
                                                        ) : issue.title.includes("< 0.16") ? (
                                                            <>
                                                                <button className="btn btn-sm btn-ghost text-[var(--danger)] text-xs" onClick={() => handleActionItem(a.id, "REMOVE")}>Confirmar Remoção</button>
                                                                <button className="btn btn-sm btn-ghost text-[var(--success)] text-xs border border-[var(--success)]" onClick={() => handleActionItem(a.id, "RESTORE")}>Forçar (Ignorar)</button>
                                                            </>
                                                        ) : (
                                                            <button className="btn btn-sm btn-ghost text-[var(--danger)] text-xs" onClick={() => handleActionItem(a.id, "REMOVE")}>Zerar/Remover</button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Conciliation / Perdas Board */}
            <div className="bg-[var(--bg-sidebar)] border border-[var(--border)] rounded-2xl overflow-hidden mt-2">
                <div className="px-6 py-5 border-b border-[var(--border)] bg-[rgba(0,0,0,0.2)]">
                    <h3 className="text-lg font-bold text-[var(--fg)]">Auditoria de Perdas e Ausências</h3>
                    <p className="text-sm text-[var(--fg-dim)] mt-1">
                        Mapeamento de todas as lojas que constavam na planilha bruta mas que não se qualificaram para gerar Lote (Ex: Fora do período, Ciclo Errado, Sem Vínculo).
                    </p>
                </div>

                <div className="max-h-[500px] overflow-y-auto w-full custom-scrollbar">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-[var(--bg-card)] sticky top-0 shadow-sm border-b border-[var(--border)]">
                            <tr>
                                <th className="py-3 px-4 text-[var(--fg-dim)] font-semibold uppercase text-xs">Loja / Ref</th>
                                <th className="py-3 px-4 text-[var(--fg-dim)] font-semibold uppercase text-xs">Status do Lote</th>
                                <th className="py-3 px-4 text-[var(--fg-dim)] font-semibold uppercase text-xs">Motivo / Rejeição</th>
                                <th className="py-3 px-4 text-[var(--fg-dim)] font-semibold text-right uppercase text-xs">Valor Bruto</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                            {/* Grouping total array to avoid individual prints of the same store */}
                            {(() => {
                                const map = new Map<string, {
                                    loja: string,
                                    validLines: number,
                                    invalidLines: number,
                                    reasons: Set<string>,
                                    totalValor: number
                                }>();

                                agendamentos.forEach(a => {
                                    const key = a.loja;
                                    if (!map.has(key)) map.set(key, { loja: a.loja, validLines: 0, invalidLines: 0, reasons: new Set(), totalValor: 0 });
                                    const m = map.get(key)!;

                                    m.totalValor += a.valorIwof;

                                    if (!a.isRemoved && (a.status === "OK" || a.status === "CORREÇÃO") && a.clienteId) {
                                        m.validLines++;
                                    } else {
                                        m.invalidLines++;
                                        if (a.isRemoved) m.reasons.add("Removida Manualmente (Ou Duplicada)");
                                        else if (!a.clienteId) m.reasons.add("Sem Vínculo/Não Encontrada no Banco");
                                        else if (a.status === "CICLO_INCORRETO") m.reasons.add("Ciclo Incorreto");
                                        else if (a.status === "FORA_PERIODO") m.reasons.add("Fora do Período");
                                        else if (a.status === "CANCELAR") m.reasons.add("Regra Irrelevante (<0.16h)");
                                        else m.reasons.add("Outro Impedimento");
                                    }
                                });

                                const rows = Array.from(map.values())
                                    .filter(x => x.invalidLines > 0)
                                    .sort((a, b) => b.totalValor - a.totalValor);

                                if (rows.length === 0) {
                                    return (
                                        <tr>
                                            <td colSpan={4} className="py-6 text-center text-[var(--fg-dim)] italic">Perfeição! Nenhuma loja ou linha sofreu perda para o lote.</td>
                                        </tr>
                                    )
                                }

                                return rows.map((r, i) => (
                                    <tr key={i} className="hover:bg-[var(--bg-card-hover)] transition-colors">
                                        <td className="py-3 px-4 font-semibold text-[var(--fg)]">{r.loja}</td>
                                        <td className="py-3 px-4">
                                            {r.validLines > 0 ? (
                                                <span className="text-[10px] font-bold px-2 py-1 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 whitespace-nowrap">
                                                    PARCIALMENTE FATURADA
                                                </span>
                                            ) : (
                                                <span className="text-[10px] font-bold px-2 py-1 rounded bg-[var(--danger)]/10 text-[var(--danger)] border border-[var(--danger)]/20 whitespace-nowrap">
                                                    NÃO FATURADA (ZERA)
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-[var(--fg-muted)] flex flex-col gap-1 text-[11px]">
                                            {Array.from(r.reasons).map((reason, ri) => (
                                                <span key={ri}>• {reason}</span>
                                            ))}
                                        </td>
                                        <td className="py-3 px-4 text-right font-mono text-[var(--danger)] font-medium">
                                            {fmtCurrency(r.totalValor)}
                                        </td>
                                    </tr>
                                ));
                            })()}
                        </tbody>
                    </table>
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

