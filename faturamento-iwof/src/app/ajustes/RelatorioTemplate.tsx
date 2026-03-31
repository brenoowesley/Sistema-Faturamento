import React from "react";

interface RelatorioTemplateProps {
    lojaId: string;
    razaoSocial: string;
    nomeFantasia: string;
    cnpj: string;
    competencia: string; // Ex: "2024-03" ou um texto livre do lote
    ciclo: string;
    valorBruto: number;
    acrescimos: number;
    descontos: number;
    valorLiquido: number;
    observacaoReport?: string;
}

export function RelatorioTemplate({ 
    lojaId,
    razaoSocial,
    nomeFantasia,
    cnpj,
    competencia,
    ciclo,
    valorBruto,
    acrescimos,
    descontos,
    valorLiquido,
    observacaoReport 
}: RelatorioTemplateProps) {
    const fmtCurrency = (val: number) =>
        new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);

    return (
        <div id={`pdf-content-${lojaId}`} className="bg-white text-gray-900 w-[794px] h-[1123px] absolute -left-[9999px] p-12 box-border flex flex-col font-sans">
            {/* Cabeçalho */}
            <div className="flex justify-between items-start border-b-2 border-gray-200 pb-6 mb-8">
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-gray-900">Relatório de Faturamento</h1>
                    <p className="text-gray-500 text-sm mt-1 uppercase tracking-widest font-bold">iWof - Plataforma de Vagas</p>
                </div>
                <div className="text-right">
                    <div className="text-xs text-gray-500 uppercase tracking-wider font-bold">Competência</div>
                    <div className="text-xl font-black text-blue-600">{competencia || "N/A"}</div>
                    <div className="text-xs text-gray-400 mt-1">Data Geração: {new Intl.DateTimeFormat("pt-BR").format(new Date())}</div>
                </div>
            </div>

            {/* Dados do Cliente */}
            <div className="bg-gray-50 p-6 rounded-xl border border-gray-100 mb-8">
                <h2 className="text-xs uppercase tracking-widest font-bold text-gray-400 mb-4">Dados do Cliente</h2>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <div className="text-[10px] uppercase font-bold tracking-wider text-gray-400">Razão Social</div>
                        <div className="font-bold text-gray-800">{razaoSocial || "-"}</div>
                    </div>
                    <div>
                        <div className="text-[10px] uppercase font-bold tracking-wider text-gray-400">Nome Fantasia</div>
                        <div className="font-bold text-gray-800">{nomeFantasia || "-"}</div>
                    </div>
                    <div>
                        <div className="text-[10px] uppercase font-bold tracking-wider text-gray-400">CNPJ</div>
                        <div className="font-mono text-sm text-gray-600">{cnpj || "-"}</div>
                    </div>
                    <div>
                        <div className="text-[10px] uppercase font-bold tracking-wider text-gray-400">Ciclo de Faturamento</div>
                        <div className="font-bold text-gray-800">{ciclo || "-"}</div>
                    </div>
                </div>
            </div>

            {/* Quadro Resumo Financeiro */}
            <h2 className="text-xs uppercase tracking-widest font-bold text-gray-400 mb-4">Resumo Financeiro</h2>
            <div className="border border-gray-200 rounded-xl overflow-hidden mb-8 shadow-sm">
                <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="py-3 px-4 text-xs font-bold uppercase tracking-wider text-gray-500">Descrição</th>
                            <th className="py-3 px-4 text-xs font-bold uppercase tracking-wider text-gray-500 text-right">Valor</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        <tr>
                            <td className="py-4 px-4 font-medium text-gray-700">Valor Bruto Apurado</td>
                            <td className="py-4 px-4 font-mono text-right text-gray-900">{fmtCurrency(valorBruto)}</td>
                        </tr>
                        <tr>
                            <td className="py-4 px-4 font-medium text-gray-700">Total Acréscimos (Manuais)</td>
                            <td className="py-4 px-4 font-mono text-right text-green-600">+{fmtCurrency(acrescimos)}</td>
                        </tr>
                        <tr>
                            <td className="py-4 px-4 font-medium text-gray-700">Total Descontos (Manuais)</td>
                            <td className="py-4 px-4 font-mono text-right text-red-600">-{fmtCurrency(descontos)}</td>
                        </tr>
                        <tr className="bg-gray-50">
                            <td className="py-4 px-4 font-black uppercase tracking-wider text-gray-900">Total Líquido Faturado</td>
                            <td className="py-4 px-4 font-mono text-right font-black text-lg text-gray-900 border-t border-gray-200">{fmtCurrency(valorLiquido)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* Observações / Descritivo Geral */}
            <h2 className="text-xs uppercase tracking-widest font-bold text-gray-400 mb-4">Observações e Descritivo de Horas</h2>
            <div className="bg-blue-50/50 p-6 rounded-xl border border-blue-100 text-gray-700 text-sm leading-relaxed whitespace-pre-wrap flex-1 flex flex-col justify-start">
                {observacaoReport || "Nenhuma observação ou ajuste manual detalhado repassado à diretoria."}
            </div>

            {/* Rodapé */}
            <div className="mt-8 pt-6 border-t border-gray-200 flex justify-between items-center text-xs text-gray-400">
                <span>Relatório Gerado Automaticamente - Plataforma iWof</span>
                <span className="font-mono">ID: {lojaId.substring(0,8)}</span>
            </div>
        </div>
    );
}
