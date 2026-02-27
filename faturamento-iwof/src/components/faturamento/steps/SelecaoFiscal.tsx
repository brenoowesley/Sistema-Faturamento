"use client";

import { useState, useMemo, useEffect } from "react";
import { ArrowLeft, ChevronRight, Check, X, Info, Search } from "lucide-react";
import { Agendamento, FinancialSummary } from "../types";
import { fmtCurrency } from "../utils";

interface SelecaoFiscalProps {
    setCurrentStep: (s: number) => void;
    agendamentos: Agendamento[];
    financialSummary: FinancialSummary;
    lojasSemNf: Set<string>;
    setLojasSemNf: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export default function SelecaoFiscal({
    setCurrentStep,
    agendamentos,
    lojasSemNf,
    setLojasSemNf
}: SelecaoFiscalProps) {

    // Aggregate valid appointments by store
    const lojasData = useMemo(() => {
        const validados = agendamentos.filter(a =>
            !a.isRemoved &&
            (a.status === "OK" || a.status === "CORREÇÃO") &&
            a.clienteId
        );

        const map = new Map<string, {
            id: string; // The client ID
            nomeCliente: string;
            razaoSocial: string;
            cnpj: string;
            numAgendamentos: number;
            valorSugerido: number;
        }>();

        for (const a of validados) {
            const cid = a.clienteId!;
            if (!map.has(cid)) {
                map.set(cid, {
                    id: cid,
                    nomeCliente: a.loja,
                    razaoSocial: a.razaoSocial || a.loja,
                    cnpj: a.cnpj || "Sem CNPJ",
                    numAgendamentos: 0,
                    valorSugerido: 0
                });
            }

            const current = map.get(cid)!;
            current.numAgendamentos += 1;
            const valor = a.status === "CORREÇÃO" ? (a.suggestedValorIwof ?? a.valorIwof) : (a.manualValue ?? a.valorIwof);
            current.valorSugerido += valor;
        }

        return Array.from(map.values()).sort((a, b) => b.valorSugerido - a.valorSugerido);
    }, [agendamentos]);

    const [searchTerm, setSearchTerm] = useState("");

    const filteredLojas = useMemo(() => {
        if (!searchTerm.trim()) return lojasData;
        const lowerSearch = searchTerm.toLowerCase();

        return lojasData.filter(loja =>
            loja.razaoSocial.toLowerCase().includes(lowerSearch) ||
            loja.nomeCliente.toLowerCase().includes(lowerSearch) ||
            loja.cnpj.includes(lowerSearch)
        );
    }, [lojasData, searchTerm]);

    // Handle initial state alignment
    useEffect(() => {
        // If a new store is brought in that was missing, by default it SHOULD emit NF
        // lojasSemNf only holds the IDs of those toggled OFF.
    }, []);

    const toggleNf = (clienteId: string) => {
        setLojasSemNf((prev: Set<string>) => {
            const next = new Set(prev);
            if (next.has(clienteId)) {
                next.delete(clienteId);
            } else {
                next.add(clienteId);
            }
            return next;
        });
    };

    const toggleAll = (forceOn: boolean) => {
        setLojasSemNf((prev: Set<string>) => {
            const next = new Set(prev);
            for (const loja of filteredLojas) {
                if (forceOn) {
                    // Turn ON emissions -> remove from lojasSemNf
                    next.delete(loja.id);
                } else {
                    // Turn OFF emissions -> add to lojasSemNf
                    next.add(loja.id);
                }
            }
            return next;
        });
    };

    const emitCount = lojasData.length - lojasSemNf.size;

    // --- Financial Summary Panel Calculations ---
    const financialMetrics = useMemo(() => {
        let baseTotal = 0;
        let nfeTotal = 0;
        let ncTotal = 0;
        let boletoFinal = 0;

        for (const loja of lojasData) {
            baseTotal += loja.valorSugerido;
            if (!lojasSemNf.has(loja.id)) {
                nfeTotal += loja.valorSugerido;
            } else {
                ncTotal += loja.valorSugerido;
            }
            boletoFinal += loja.valorSugerido; // Boleto is simply the gross total without tax disc. mapping right now
        }

        return {
            baseTotal,
            nfeTotal,
            ncTotal,
            acrescidos: 0,
            descontos: 0,
            boletoFinal
        };
    }, [lojasData, lojasSemNf]);

    return (
        <div className="flex flex-col gap-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-2">
                <button className="btn btn-ghost text-[var(--fg-dim)] hover:text-[var(--fg)]" onClick={() => setCurrentStep(2)}>
                    <ArrowLeft size={16} /> Voltar ao Resumo
                </button>
                <button className="btn btn-primary" onClick={() => setCurrentStep(4)}>
                    Avançar para Emissão <ChevronRight size={16} />
                </button>
            </div>

            <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-[var(--fg)] mb-2">Seleção Fiscal</h2>
                <p className="text-[var(--fg-dim)]">
                    Escolha quais lojas deverão ter a Nota Fiscal Eletrônica (NF-e) gerada na próxima etapa e quais terão NF Inibida.
                </p>
            </div>

            <div className="bg-gradient-to-r from-[var(--bg-sidebar)] to-[rgba(33,118,255,0.05)] border border-[var(--border)] rounded-2xl p-6 shadow-sm">

                {/* Search & Filter Header */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6 pb-6 border-b border-[var(--border)]">
                    <div>
                        <h3 className="font-bold text-[var(--fg)] text-xl">
                            <span className="text-[var(--accent)]">{emitCount}</span> de {lojasData.length} Lojas Emitirão NF
                        </h3>
                        <p className="text-sm text-[var(--fg-muted)] mt-1">Lojas apagadas não irão aparecer na etapa de geração de notas da Conta Azul.</p>
                    </div>

                    <div className="flex flex-col md:flex-row items-end md:items-center gap-4">
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Search size={16} className="text-[var(--fg-dim)]" />
                            </div>
                            <input
                                type="text"
                                className="input w-full md:w-64 pl-10 h-10 bg-[var(--bg-card)] border-[var(--border)] focus:border-[var(--accent)] text-sm"
                                placeholder="Buscar CNPJ ou Loja..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="flex gap-2">
                            <button className="btn btn-ghost h-10 px-4 text-[var(--danger)] bg-[rgba(239,68,68,0.1)] hover:bg-[var(--danger)] hover:text-white" onClick={() => toggleAll(false)} title="Desmarcar todas as lojas atualmente filtradas na busca">
                                <X size={16} className="mr-1.5" /> Desmarcar Filtrados
                            </button>
                            <button className="btn btn-ghost h-10 px-4 text-[var(--success)] bg-[rgba(34,197,94,0.1)] hover:bg-[var(--success)] hover:text-white" onClick={() => toggleAll(true)} title="Marcar todas as lojas atualmente filtradas na busca">
                                <Check size={16} className="mr-1.5" /> Marcar Filtrados
                            </button>
                        </div>
                    </div>
                </div>

                {/* Financial Summary KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <div className="p-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
                        <p className="text-[10px] font-bold text-[var(--fg-muted)] uppercase tracking-wider mb-1">Valor Base</p>
                        <p className="font-mono font-bold text-lg text-[var(--fg)]">{fmtCurrency(financialMetrics.baseTotal)}</p>
                    </div>
                    <div className="p-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
                        <p className="text-[10px] font-bold text-[var(--fg-muted)] uppercase tracking-wider mb-1">Acréscimos</p>
                        <p className="font-mono font-bold text-lg text-[var(--success)]">{fmtCurrency(financialMetrics.acrescidos)}</p>
                    </div>
                    <div className="p-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
                        <p className="text-[10px] font-bold text-[var(--fg-muted)] uppercase tracking-wider mb-1">Descontos</p>
                        <p className="font-mono font-bold text-lg text-[var(--danger)]">{fmtCurrency(financialMetrics.descontos)}</p>
                    </div>
                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                        <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-1">Faturamento (NF-e)</p>
                        <p className="font-mono font-bold text-lg text-blue-500">{fmtCurrency(financialMetrics.nfeTotal)}</p>
                    </div>
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                        <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-1">Sem Emissão (NC)</p>
                        <p className="font-mono font-bold text-lg text-amber-500">{fmtCurrency(financialMetrics.ncTotal)}</p>
                    </div>
                    <div className="p-3 bg-[var(--accent)] border border-[var(--accent)] rounded-xl shadow-md">
                        <p className="text-[10px] font-bold text-white/80 uppercase tracking-wider mb-1">Boleto Final Estimado</p>
                        <p className="font-mono font-bold text-lg text-white">{fmtCurrency(financialMetrics.boletoFinal)}</p>
                    </div>
                </div>
            </div>

            <div className="bg-[var(--bg-sidebar)] border border-[var(--border)] rounded-2xl overflow-hidden mt-2">
                <table className="w-full text-left text-sm">
                    <thead className="bg-[rgba(0,0,0,0.2)] border-b border-[var(--border)]">
                        <tr>
                            <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold w-[100px] text-center">Emitir NF?</th>
                            <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold">Cliente</th>
                            <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-center">Agendamentos</th>
                            <th className="py-4 px-6 text-[var(--fg-dim)] font-semibold text-right">Valor Líquido</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                        {filteredLojas.map(loja => {
                            const emitsNf = !lojasSemNf.has(loja.id);

                            return (
                                <tr key={loja.id} className={`transition-colors ${emitsNf ? "hover:bg-[var(--bg-card-hover)]" : "bg-[rgba(0,0,0,0.2)] opacity-70"}`}>
                                    <td className="py-4 px-6 text-center align-middle">
                                        <label className="relative inline-flex items-center cursor-pointer justify-center">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={emitsNf}
                                                onChange={() => toggleNf(loja.id)}
                                            />
                                            <div className="w-11 h-6 bg-[var(--bg-card)] border border-[var(--border)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-[var(--fg-dim)] peer-checked:after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent)] peer-checked:border-[var(--accent)]"></div>
                                        </label>
                                    </td>
                                    <td className="py-4 px-6">
                                        <p className={`font-bold ${emitsNf ? "text-[var(--fg)]" : "text-[var(--fg-dim)] line-through decoration-[var(--border)] decoration-2"}`}>
                                            {loja.razaoSocial}
                                        </p>
                                        <p className="text-[10px] text-[var(--fg-muted)] font-mono mt-1">
                                            Nome CA: {loja.nomeCliente} • CNPJ: {loja.cnpj}
                                        </p>
                                    </td>
                                    <td className="py-4 px-6 text-center text-[var(--fg-dim)]">
                                        {loja.numAgendamentos}
                                    </td>
                                    <td className="py-4 px-6 text-right">
                                        <span className={`font-mono font-bold ${emitsNf ? "text-[var(--success)]" : "text-[var(--fg-dim)] line-through decoration-[var(--border)]"}`}>
                                            {fmtCurrency(loja.valorSugerido)}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredLojas.length === 0 && (
                            <tr>
                                <td colSpan={4} className="py-12 text-center text-[var(--fg-dim)]">
                                    <Info size={32} className="mx-auto mb-3 opacity-20" />
                                    <p>{lojasData.length > 0 ? "Nenhuma loja encontrada para a pesquisa atual." : "Não há clientes válidos para configurar NF. Verifique as conciliações na etapa anterior."}</p>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

