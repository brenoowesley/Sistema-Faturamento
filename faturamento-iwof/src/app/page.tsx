"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard,
  Users,
  FileText,
  TrendingUp,
  AlertCircle,
  Clock,
  CheckCircle2,
  ArrowRight,
  Loader2,
  ShieldCheck,
  Trash2,
  MessageSquare
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

interface Stats {
  faturamentoTotal: number;
  clientesAtivos: number;
  lotesPendentes: number;
  ajustesPendentes: number;
}

interface LoteRecente {
  id: string;
  data_competencia: string;
  status: string;
  created_at: string;
  delete_request_status?: string | null;
}

interface CicloStats {
  nome: string;
  total: number;
}

import { Suspense } from "react";

function DashboardContent() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({
    faturamentoTotal: 0,
    clientesAtivos: 0,
    lotesPendentes: 0,
    ajustesPendentes: 0
  });
  const [lotesRecentes, setLotesRecentes] = useState<LoteRecente[]>([]);
  const [cicloStats, setCicloStats] = useState<CicloStats[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const authError = searchParams.get("auth_error");

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      // 0. User Role
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: perfil } = await supabase
          .from("usuarios_perfis")
          .select("cargo")
          .eq("id", user.id)
          .single();
        setUserRole(perfil?.cargo || "USER");
      }
      // 1. Clientes Ativos
      const { count: clientesCount } = await supabase
        .from("clientes")
        .select("*", { count: "exact", head: true })
        .eq("status", true);

      // 2. Lotes Pendentes
      const { count: lotesCount } = await supabase
        .from("faturamentos_lote")
        .select("*", { count: "exact", head: true })
        .neq("status", "CONSOLIDADO");

      // 3. Faturamento Total (Soma das Notas Emitidas)
      const { data: consolidados } = await supabase
        .from("faturamento_consolidados")
        .select("valor_nf_emitida, cliente_id(ciclo_faturamento_id(nome))");

      const totalFaturado = (consolidados || []).reduce((acc, curr) => acc + (Number(curr.valor_nf_emitida) || 0), 0);

      // Agrupamento por Ciclo para o Gráfico
      const agruparPorCiclo = (consolidados || []).reduce((acc: any, curr: any) => {
        const cicloNome = curr.cliente_id?.ciclo_faturamento_id?.nome || "OUTROS";
        acc[cicloNome] = (acc[cicloNome] || 0) + (Number(curr.valor_nf_emitida) || 0);
        return acc;
      }, {});

      const formatadoParaGrafico = Object.entries(agruparPorCiclo).map(([nome, total]) => ({
        nome,
        total: total as number
      })).sort((a, b) => b.total - a.total);

      setCicloStats(formatadoParaGrafico);

      // 4. Ajustes Pendentes (Ainda não aplicados)
      const { data: ajustes } = await supabase
        .from("ajustes_faturamento")
        .select("valor")
        .eq("status_aplicacao", false);

      const totalAjustes = (ajustes || []).reduce((acc, curr) => acc + (Number(curr.valor) || 0), 0);

      // 5. Lotes Recentes
      const { data: lotes } = await supabase
        .from("faturamentos_lote")
        .select("id, data_competencia, status, created_at, delete_request_status")
        .order("created_at", { ascending: false })
        .limit(5);

      setStats({
        clientesAtivos: clientesCount || 0,
        lotesPendentes: lotesCount || 0,
        faturamentoTotal: totalFaturado,
        ajustesPendentes: totalAjustes
      });
      setLotesRecentes(lotes || []);

    } catch (err) {
      console.error("Erro ao carregar dashboard:", err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const formatCurrency = (value: number, short = false) => {
    if (short && value >= 1000) {
      return `R$ ${(value / 1000).toFixed(1)}k`;
    }
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "CONSOLIDADO": return "text-emerald-500 bg-emerald-500/10";
      case "FISCAL": return "text-amber-500 bg-amber-500/10";
      case "PROCESSING": return "text-indigo-500 bg-indigo-500/10";
      default: return "text-[var(--fg-dim)] bg-white/5";
    }
  };

  const maxCicloValor = Math.max(...cicloStats.map(s => s.total), 1);

  const handleDeleteLote = async (loteId: string) => {
    if (userRole === "ADMIN") {
      if (!confirm("Tem certeza que deseja EXCLUIR este lote permanentemente? Isso resetará os ajustes vinculados.")) return;

      const { error } = await supabase.rpc('safe_delete_lote', { target_lote_id: loteId });
      if (error) {
        alert("Erro ao excluir lote: " + error.message);
      } else {
        alert("Lote excluído com sucesso!");
        fetchDashboardData();
      }
    } else {
      const reason = prompt("Informe o motivo para a solicitação de exclusão:");
      if (!reason) return;

      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("faturamentos_lote")
        .update({
          delete_requested_at: new Date().toISOString(),
          delete_requested_by: user?.id,
          delete_reason: reason,
          delete_request_status: 'PENDING'
        })
        .eq("id", loteId);

      if (error) {
        alert("Erro ao solicitar exclusão: " + error.message);
      } else {
        alert("Solicitação de exclusão enviada ao administrador.");
        fetchDashboardData();
      }
    }
  };

  if (loading) {
    return (
      <div className="p-20 flex flex-col items-center justify-center gap-4">
        <Loader2 className="animate-spin text-indigo-500" size={40} />
        <p className="text-[var(--fg-dim)]">Carregando indicadores...</p>
      </div>
    );
  }

  return (
    <main className="space-y-8 max-w-7xl mx-auto pb-12">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-3">
          <LayoutDashboard className="text-indigo-500" size={32} />
          Painel de Controle
        </h1>
        <p className="page-description">
          Visão estratégica do fluxo de faturamento e saúde financeira.
        </p>
      </div>

      {authError === "unauthorized_role" && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-center gap-4 text-red-500 animate-in fade-in slide-in-from-top-4">
          <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
            <ShieldCheck size={20} className="icon-high-contrast" />
          </div>
          <div>
            <p className="text-sm font-bold">Acesso Negado</p>
            <p className="text-xs opacity-80">Você não tem permissões de administrador para acessar a página solicitada.</p>
          </div>
        </div>
      )}

      {userRole === "ADMIN" && lotesRecentes.some(l => l.delete_request_status === 'PENDING') && (
        <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl flex items-center justify-between gap-4 text-amber-500 animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
              <AlertCircle size={20} className="icon-high-contrast" />
            </div>
            <div>
              <p className="text-sm font-bold">Solicitações de Exclusão Pendentes</p>
              <p className="text-xs opacity-80">Existem lotes com pedidos de exclusão aguardando sua revisão.</p>
            </div>
          </div>
          <Link href="/faturamentos" className="btn-icon bg-amber-500/20 hover:bg-amber-500/30 text-amber-500">
            Revisar <ArrowRight size={14} />
          </Link>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card p-6 border-b-4 border-b-emerald-500/30">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-[var(--fg-dim)] uppercase tracking-widest">Faturamento Total</span>
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500"><TrendingUp size={18} /></div>
          </div>
          <p className="text-2xl font-black text-white">{formatCurrency(stats.faturamentoTotal)}</p>
          <p className="text-[10px] text-[var(--fg-dim)] mt-1">Acumulado histórico</p>
        </div>

        <div className="card p-6 border-b-4 border-b-indigo-500/30">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-[var(--fg-dim)] uppercase tracking-widest">Clientes Ativos</span>
            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-500"><Users size={18} /></div>
          </div>
          <p className="text-2xl font-black text-white">{stats.clientesAtivos}</p>
          <p className="text-[10px] text-[var(--fg-dim)] mt-1">Empresas em operação</p>
        </div>

        <div className="card p-6 border-b-4 border-b-amber-500/30">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-[var(--fg-dim)] uppercase tracking-widest">Lotes Pendentes</span>
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-500"><Clock size={18} /></div>
          </div>
          <p className="text-2xl font-black text-white">{stats.lotesPendentes}</p>
          <p className="text-[10px] text-[var(--fg-dim)] mt-1">Aguardando consolidação</p>
        </div>

        <div className="card p-6 border-b-4 border-b-red-500/30">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-[var(--fg-dim)] uppercase tracking-widest">Ajustes em Aberto</span>
            <div className="p-2 bg-red-500/10 rounded-lg text-red-500"><AlertCircle size={18} /></div>
          </div>
          <p className="text-2xl font-black text-white">{formatCurrency(stats.ajustesPendentes)}</p>
          <p className="text-[10px] text-[var(--fg-dim)] mt-1">Acréscimos/Descontos pendentes</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Gráfico de Ciclos */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <TrendingUp className="text-indigo-500" size={20} />
            Faturamento por Ciclo
          </h2>
          <div className="card h-[300px] flex items-end justify-around gap-2 p-8 pt-12">
            {cicloStats.map((ciclo) => (
              <div key={ciclo.nome} className="flex-1 flex flex-col items-center group relative h-full justify-end">
                <div
                  className="w-full max-w-[40px] bg-gradient-to-t from-indigo-600 to-indigo-400 rounded-t-lg transition-all duration-500 group-hover:from-indigo-500 group-hover:to-indigo-300 relative group"
                  style={{ height: `${(ciclo.total / maxCicloValor) * 100}%` }}
                >
                  {/* Tooltip */}
                  <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-white text-black text-[10px] font-bold px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-lg">
                    {formatCurrency(ciclo.total)}
                  </div>
                </div>
                <span className="text-[10px] font-bold text-[var(--fg-dim)] uppercase mt-3 tracking-tighter text-center">
                  {ciclo.nome}
                </span>
              </div>
            ))}
            {cicloStats.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full w-full text-[var(--fg-dim)] italic text-sm">
                Dados insuficientes para o gráfico.
              </div>
            )}
          </div>
        </div>

        {/* Atalhos Rápidos */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <h2 className="text-lg font-bold text-white mb-4">Ações Rápidas</h2>
          </div>
          <Link href="/faturamento/novo" className="card p-5 hover:border-indigo-500/50 transition-all flex items-center gap-4 group">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 group-hover:bg-indigo-500 group-hover:text-white transition-all shadow-inner">
              <FileText size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors">Novo Faturamento</p>
              <p className="text-[10px] text-[var(--fg-dim)]">Processar planilha bruta</p>
            </div>
          </Link>
          <Link href="/ajustes" className="card p-5 hover:border-amber-500/50 transition-all flex items-center gap-4 group">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 group-hover:bg-amber-500 group-hover:text-white transition-all shadow-inner">
              <AlertCircle size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-white group-hover:text-amber-400 transition-colors">Gerenciar Ajustes</p>
              <p className="text-[10px] text-[var(--fg-dim)]">Gerar acréscimos/descontos</p>
            </div>
          </Link>
          <Link href="/clientes" className="card p-5 hover:border-emerald-500/50 transition-all flex items-center gap-4 group">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 group-hover:bg-emerald-500 group-hover:text-white transition-all shadow-inner">
              <Users size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors">Base de Clientes</p>
              <p className="text-[10px] text-[var(--fg-dim)]">Cadastrar e atualizar lojas</p>
            </div>
          </Link>
          <Link href="/usuarios" className="card p-5 hover:border-indigo-500/50 transition-all flex items-center gap-4 group">
            <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 group-hover:bg-indigo-500 group-hover:text-white transition-all shadow-inner">
              <ShieldCheck size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors">Gestão Usuários</p>
              <p className="text-[10px] text-[var(--fg-dim)]">Controle de acessos</p>
            </div>
          </Link>
        </div>
      </div>

      {/* Segunda Linha: Lotes Recentes */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Clock className="text-indigo-500" size={20} />
            Lotes em Processamento
          </h2>
          <Link href="/faturamentos" className="text-xs text-indigo-500 hover:underline font-bold">Histórico Completo</Link>
        </div>

        <div className="card overflow-hidden !p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/5">
                  <th className="p-4 text-[10px] font-bold text-[var(--fg-dim)] uppercase tracking-widest">Competência</th>
                  <th className="p-4 text-[10px] font-bold text-[var(--fg-dim)] uppercase tracking-widest">Status Atual</th>
                  <th className="p-4 text-[10px] font-bold text-[var(--fg-dim)] uppercase tracking-widest">Criado em</th>
                  <th className="p-4"></th>
                </tr>
              </thead>
              <tbody>
                {lotesRecentes.map(lote => (
                  <tr key={lote.id} className="border-t border-[var(--border)] hover:bg-white/[0.02] transition-colors">
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-white">
                          {new Date(lote.data_competencia).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                        </span>
                        <span className="text-[10px] text-[var(--fg-dim)] font-mono">{lote.id.slice(0, 8)}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest ${getStatusColor(lote.status)}`}>
                        {lote.status}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="text-xs text-[var(--fg-dim)]">
                        {new Date(lote.created_at).toLocaleDateString('pt-BR')}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {lote.delete_request_status === 'PENDING' && (
                          <span className="flex items-center gap-1 text-[9px] font-bold text-amber-500 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20">
                            <Clock size={10} /> EXCLUSÃO PENDENTE
                          </span>
                        )}
                        <button
                          onClick={() => handleDeleteLote(lote.id)}
                          className="p-2 hover:bg-red-500/10 text-[var(--fg-dim)] hover:text-red-500 rounded-lg transition-all"
                          title={userRole === "ADMIN" ? "Excluir Lote" : "Solicitar Exclusão"}
                        >
                          <Trash2 size={16} />
                        </button>
                        <Link
                          href={`/faturamento/lote/${lote.id}`}
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-500 text-xs font-bold hover:bg-indigo-500 hover:text-white transition-all"
                        >
                          Acessar Lote
                          <ArrowRight size={14} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
                {lotesRecentes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-12 text-center text-[var(--fg-dim)] text-sm italic">
                      Nenhum lote registrado no sistema.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="p-20 flex flex-col items-center justify-center gap-4">
        <p className="text-[var(--fg-dim)]">Carregando painel...</p>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
