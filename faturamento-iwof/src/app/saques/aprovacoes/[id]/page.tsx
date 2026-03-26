"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    ArrowLeft,
    Check,
    X,
    AlertTriangle,
    Loader2,
    ShieldAlert,
    Banknote,
    TrendingUp,
    ArrowDownCircle,
    RotateCcw,
    Send,
    Trash2,
    Edit,
    Save,
    XCircle,
    Layers,
} from "lucide-react";

export const dynamic = "force-dynamic";

type PixType = "EMAIL" | "CPF" | "CNPJ" | "CHAVE_ALEATORIA" | "TELEFONE";
const PIX_TYPE_OPTIONS: PixType[] = ["EMAIL", "CPF", "CNPJ", "CHAVE_ALEATORIA", "TELEFONE"];

interface ItemSaque {
    id: string;
    nome_usuario: string;
    cpf_favorecido: string;
    chave_pix: string;
    tipo_pix: string;
    valor: number;
    valor_solicitado: number | null;
    status_item: string;
    motivo_bloqueio: string | null;
    transfeera_transfer_id: string | null;
    chave_corrigida_automaticamente: boolean;
}

interface LoteDetalhe {
    id: string;
    nome_lote: string;
    tipo_saque: string;
    total_real: number;
    total_solicitado: number;
    receita_financeira: number;
    valor_solicitado_total: number | null;
    valor_devolvido: number | null;
    status: string;
    transfeera_batch_id: string | null;
    created_at: string;
}

function MetricCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
    return (
        <div className="card" style={{ padding: "16px 20px", borderColor: `${color}25` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                {icon}
                <span style={{ fontSize: 11, color: "var(--fg-dim)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</span>
            </div>
            <span style={{ fontSize: 22, fontWeight: 800, color }}>{value < 0 ? "-" : ""}R$ {Math.abs(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { bg: string; fg: string; label: string }> = {
        APROVADO: { bg: "rgba(34,197,94,0.1)", fg: "#22c55e", label: "Aprovado" },
        REVISAO: { bg: "rgba(234,179,8,0.1)", fg: "#eab308", label: "Revisão" },
        BLOQUEADO: { bg: "rgba(239,68,68,0.1)", fg: "#ef4444", label: "Bloqueado" },
    };
    const s = map[status] || { bg: "rgba(156,163,175,0.1)", fg: "#9ca3af", label: status };
    return (
        <span style={{ background: s.bg, color: s.fg, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
            {s.label}
        </span>
    );
}

export default function LoteDetalhePage() {
    const supabase = createClient();
    const { id } = useParams<{ id: string }>();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [authorized, setAuthorized] = useState(false);
    const [lote, setLote] = useState<LoteDetalhe | null>(null);
    const [items, setItems] = useState<ItemSaque[]>([]);
    const [processingAction, setProcessingAction] = useState(false);
    const [actionMsg, setActionMsg] = useState<{ type: "success" | "error" | "warning"; text: string } | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<Partial<ItemSaque>>({});

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: perfil } = await supabase
                .from("usuarios_perfis")
                .select("cargo")
                .eq("id", user.id)
                .single();

            if (perfil?.cargo !== "ADMIN" && perfil?.cargo !== "APROVADOR") return;
            setAuthorized(true);

            const { data: loteData } = await supabase
                .from("lotes_saques")
                .select("*")
                .eq("id", id)
                .single();

            if (loteData) setLote(loteData as LoteDetalhe);

            const { data: itensData } = await supabase
                .from("itens_saque")
                .select("*")
                .eq("lote_id", id)
                .order("nome_usuario", { ascending: true });

            if (itensData) setItems(itensData as ItemSaque[]);
        } catch (err) {
            console.error("Erro ao carregar detalhe do lote:", err);
        } finally {
            setLoading(false);
        }
    }, [supabase, id]);

    useEffect(() => { loadData(); }, [loadData]);

    function startEdit(item: ItemSaque) {
        setEditingId(item.id);
        setEditForm({
            nome_usuario: item.nome_usuario,
            cpf_favorecido: item.cpf_favorecido,
            chave_pix: item.chave_pix,
            tipo_pix: item.tipo_pix,
            valor: item.valor,
        });
    }

    async function saveEdit() {
        if (!editingId) return;
        const { error } = await supabase
            .from("itens_saque")
            .update({
                nome_usuario: editForm.nome_usuario,
                cpf_favorecido: editForm.cpf_favorecido,
                chave_pix: editForm.chave_pix,
                tipo_pix: editForm.tipo_pix,
                valor: editForm.valor,
                status_item: "APROVADO",
                motivo_bloqueio: null,
                transfeera_transfer_id: null, // Reset so it gets re-sent
            })
            .eq("id", editingId);

        if (error) {
            alert("Erro ao salvar: " + error.message);
        } else {
            setEditingId(null);
            loadData();
        }
    }

    async function deleteItem(itemId: string) {
        if (!confirm("Deseja excluir este item? A ação não pode ser desfeita.")) return;
        const { error } = await supabase.from("itens_saque").delete().eq("id", itemId);
        if (error) {
            alert("Erro ao excluir: " + error.message);
        } else {
            setItems((prev) => prev.filter((i) => i.id !== itemId));
        }
    }

    async function handleApprove() {
        if (!confirm("Tem certeza que deseja aprovar este lote e enviar para a Transfeera?\n\nModelo: Tudo ou Nada — se houver qualquer erro, o lote inteiro será rejeitado.")) return;
        setProcessingAction(true);
        setActionMsg(null);
        try {
            const res = await fetch("/api/transfeera/aprovar-lote", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lote_id: id }),
            });
            const data = await res.json();

            if (!res.ok) {
                const detail = data.transfeera_error
                    ? (typeof data.transfeera_error === "string" ? data.transfeera_error : JSON.stringify(data.transfeera_error))
                    : "";
                throw new Error(`${data.error || "Erro ao aprovar lote"}${detail ? " — " + detail : ""}`);
            }

            setActionMsg({ type: "success", text: `Lote aprovado e enviado com sucesso! (${data.items_count} transferências)` });
            setTimeout(() => router.push("/saques/aprovacoes"), 2000);
        } catch (err: any) {
            setActionMsg({ type: "error", text: err.message });
        } finally {
            setProcessingAction(false);
        }
    }

    async function handleReject() {
        if (!confirm("ATENÇÃO: Rejeitar o lote irá excluí-lo permanentemente, junto com todos os seus itens. Deseja continuar?")) return;
        setProcessingAction(true);
        try {
            const { error } = await supabase.from("lotes_saques").delete().eq("id", id);
            if (error) throw error;
            alert("Lote rejeitado e excluído com sucesso.");
            router.push("/saques/aprovacoes");
        } catch (err: any) {
            alert("Erro ao rejeitar: " + err.message);
        } finally {
            setProcessingAction(false);
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-20 gap-4">
                <Loader2 className="animate-spin text-accent" size={40} />
                <p className="text-[var(--fg-dim)]">Carregando detalhe do lote...</p>
            </div>
        );
    }

    if (!authorized) {
        return (
            <div className="flex flex-col items-center justify-center p-20 text-center space-y-4">
                <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 mb-2">
                    <ShieldAlert size={40} />
                </div>
                <h1 className="text-2xl font-black text-white">Acesso Negado</h1>
                <p className="text-[var(--fg-dim)] max-w-md">
                    Esta área é restrita a Administradores e Aprovadores.
                </p>
            </div>
        );
    }

    if (!lote) {
        return (
            <div className="p-20 text-center text-[var(--fg-dim)]">Lote não encontrado.</div>
        );
    }

    const aprovados = items.filter((i) => i.status_item === "APROVADO");
    const revisao = items.filter((i) => i.status_item === "REVISAO");
    const bloqueados = items.filter((i) => i.status_item === "BLOQUEADO");
    const totalReal = aprovados.reduce((s, i) => s + Number(i.valor), 0);
    const totalSolicitado = lote.valor_solicitado_total ?? lote.total_solicitado ?? 0;
    const receitaFinanceira = lote.receita_financeira ?? (totalSolicitado - totalReal);
    const valorDevolvido = lote.valor_devolvido ?? 0;

    const inputStyle: React.CSSProperties = {
        background: "rgba(255,255,255,0.04)",
        border: "1px solid var(--border-light)",
        borderRadius: 6,
        padding: "4px 8px",
        fontSize: 12,
        color: "var(--fg)",
        width: "100%",
    };

    return (
        <main className="p-8 max-w-7xl mx-auto space-y-8 pb-20">
            {/* Header */}
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <button onClick={() => router.push("/saques/aprovacoes")} className="btn btn-ghost" style={{ padding: "8px 12px" }}>
                        <ArrowLeft size={18} />
                    </button>
                    <div>
                        <h1 className="text-2xl font-black text-white">{lote.nome_lote}</h1>
                        <div className="flex items-center gap-3 mt-1">
                            <span className="px-2 py-1 rounded-md bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold tracking-widest uppercase">
                                {lote.tipo_saque}
                            </span>
                            <span className="text-[var(--fg-dim)] text-xs">
                                {new Date(lote.created_at).toLocaleDateString("pt-BR")}
                            </span>
                            <span className="text-[var(--fg-dim)] text-xs flex items-center gap-1">
                                <Layers size={12} /> {items.length} itens
                            </span>
                        </div>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleReject}
                        disabled={processingAction}
                        className="btn border border-red-500/30 bg-red-500/5 text-red-500 hover:bg-red-500 hover:text-white flex items-center gap-2 py-2.5 px-4 text-xs font-bold transition-all rounded-xl"
                    >
                        {processingAction ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                        Rejeitar Lote
                    </button>
                    <button
                        onClick={handleApprove}
                        disabled={processingAction}
                        className="btn bg-accent text-white hover:opacity-90 flex items-center gap-2 py-2.5 px-4 text-xs font-bold transition-all rounded-xl shadow-[0_4px_12px_rgba(33,118,255,0.3)]"
                    >
                        {processingAction ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                        Aprovar e Disparar Transfeera
                    </button>
                </div>
            </header>

            {/* Action Messages */}
            {actionMsg && (
                <div className={`card p-4 flex items-start gap-3 ${
                    actionMsg.type === "success" ? "bg-green-500/5 border-green-500/10" :
                    actionMsg.type === "warning" ? "bg-orange-500/5 border-orange-500/10" :
                    "bg-red-500/5 border-red-500/10"
                }`}>
                    {actionMsg.type === "success" ? <Check className="text-green-500 shrink-0 mt-0.5" size={18} /> :
                     actionMsg.type === "warning" ? <AlertTriangle className="text-orange-500 shrink-0 mt-0.5" size={18} /> :
                     <XCircle className="text-red-500 shrink-0 mt-0.5" size={18} />}
                    <p className="text-sm" style={{ color: actionMsg.type === "success" ? "#22c55e" : actionMsg.type === "warning" ? "#f97316" : "#ef4444" }}>
                        {actionMsg.text}
                    </p>
                </div>
            )}

            {/* Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Vlr. Solicitado Total" value={totalSolicitado} color="#a78bfa" icon={<Banknote size={16} color="#a78bfa" />} />
                <MetricCard label="Custo Lote (Real)" value={totalReal} color="#2176ff" icon={<ArrowDownCircle size={16} color="#2176ff" />} />
                <MetricCard label="Receita Financeira" value={receitaFinanceira} color="#22c55e" icon={<TrendingUp size={16} color="#22c55e" />} />
                <MetricCard label="Valor Devolvido" value={valorDevolvido} color="#f97316" icon={<RotateCcw size={16} color="#f97316" />} />
            </div>

            {/* Status Summary */}
            <div className="flex gap-3 items-center text-xs font-bold">
                <span className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-500">{aprovados.length} Aprovados</span>
                {revisao.length > 0 && <span className="px-3 py-1.5 rounded-lg bg-yellow-500/10 text-yellow-500">{revisao.length} Em Revisão</span>}
                {bloqueados.length > 0 && <span className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500">{bloqueados.length} Bloqueados</span>}
            </div>

            {/* Items Table */}
            <div className="card overflow-hidden" style={{ borderColor: "var(--border-light)" }}>
                <div style={{ overflowX: "auto" }}>
                    <table className="data-table" style={{ width: "100%" }}>
                        <thead>
                            <tr>
                                <th>Nome</th>
                                <th>CPF</th>
                                <th>Chave PIX</th>
                                <th>Tipo PIX</th>
                                <th>Valor (R$)</th>
                                <th>Status</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item) => {
                                const isEditing = editingId === item.id;
                                const isFailed = item.status_item === "REVISAO" || (!item.transfeera_transfer_id && item.motivo_bloqueio);
                                return (
                                    <tr key={item.id} style={isFailed ? { backgroundColor: "rgba(248,113,113,0.06)", outline: "1px solid rgba(248,113,113,0.3)" } : {}}>
                                        <td style={{ fontSize: 12, color: "var(--fg-dim)" }}>
                                            {isEditing ? (
                                                <input style={inputStyle} value={editForm.nome_usuario || ""} onChange={(e) => setEditForm(p => ({ ...p, nome_usuario: e.target.value }))} />
                                            ) : (
                                                <>
                                                    {item.nome_usuario || "—"}
                                                    {item.motivo_bloqueio && (
                                                        <div style={{ color: "var(--danger)", fontSize: 10, fontWeight: 700, marginTop: 3 }}>
                                                            ⚠ {item.motivo_bloqueio}
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </td>
                                        <td className="table-mono" style={{ fontSize: 12 }}>
                                            {isEditing ? (
                                                <input style={inputStyle} value={editForm.cpf_favorecido || ""} onChange={(e) => setEditForm(p => ({ ...p, cpf_favorecido: e.target.value }))} />
                                            ) : item.cpf_favorecido}
                                        </td>
                                        <td className="table-mono" style={{ fontSize: 11 }}>
                                            {isEditing ? (
                                                <input style={inputStyle} value={editForm.chave_pix || ""} onChange={(e) => setEditForm(p => ({ ...p, chave_pix: e.target.value }))} />
                                            ) : (
                                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                    {item.chave_pix}
                                                    {item.chave_corrigida_automaticamente && (
                                                        <span title="Chave corrigida automaticamente" style={{ cursor: "help" }}>
                                                            <AlertTriangle size={12} color="#eab308" />
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            {isEditing ? (
                                                <select style={{ ...inputStyle, width: "auto" }} value={editForm.tipo_pix || ""} onChange={(e) => setEditForm(p => ({ ...p, tipo_pix: e.target.value }))}>
                                                    {PIX_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                                </select>
                                            ) : (
                                                <span style={{ background: "rgba(33,118,255,0.08)", color: "var(--accent)", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                                                    {item.tipo_pix}
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ fontWeight: 600, color: "var(--accent)" }}>
                                            {isEditing ? (
                                                <input style={{ ...inputStyle, width: 90 }} type="number" step="0.01" value={editForm.valor ?? ""} onChange={(e) => setEditForm(p => ({ ...p, valor: parseFloat(e.target.value) || 0 }))} />
                                            ) : (
                                                `R$ ${Number(item.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                                            )}
                                        </td>
                                        <td><StatusBadge status={item.status_item} /></td>
                                        <td>
                                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                                {isEditing ? (
                                                    <>
                                                        <button className="btn btn-ghost" style={{ padding: "4px 8px", color: "var(--success)" }} onClick={saveEdit} title="Salvar"><Save size={14} /></button>
                                                        <button className="btn btn-ghost" style={{ padding: "4px 8px", color: "var(--fg-dim)" }} onClick={() => setEditingId(null)} title="Cancelar"><X size={14} /></button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button className="btn btn-ghost" style={{ padding: "4px 8px", color: "var(--accent)" }} onClick={() => startEdit(item)} title="Editar"><Edit size={14} /></button>
                                                        <button className="btn btn-ghost" style={{ padding: "4px 8px", color: "var(--danger)" }} onClick={() => deleteItem(item.id)} title="Excluir"><Trash2 size={14} /></button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {items.length === 0 && (
                                <tr><td colSpan={7} style={{ textAlign: "center", padding: 40, color: "var(--fg-dim)" }}>Nenhum item neste lote.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Warning */}
            <div className="card p-4 bg-orange-500/5 border-orange-500/10 flex items-start gap-3">
                <AlertTriangle className="text-orange-500 shrink-0 mt-0.5" size={18} />
                <div>
                    <p className="text-xs font-bold text-orange-200/80">Modelo: Tudo ou Nada</p>
                    <p className="text-[10px] text-orange-200/50 leading-relaxed mt-1">
                        Ao aprovar, todos os itens serão enviados em lote único para a Transfeera.
                        Se qualquer item tiver uma chave PIX inválida, o lote inteiro será rejeitado.
                        Corrija os itens na tabela antes de aprovar.
                    </p>
                </div>
            </div>
        </main>
    );
}
