"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ChevronDown, ChevronUp, History, CheckCircle2, XCircle, AlertTriangle, TrendingUp, Trash2 } from "lucide-react";

interface Lote {
    id: string;
    nome_lote: string;
    tipo_saque: string | null;
    status: string;
    total_solicitado: number | null;
    total_real: number | null;
    receita_financeira: number | null;
    created_at: string;
}

interface ItemSaque {
    id: string;
    cpf_favorecido: string;
    nome_usuario: string | null;
    chave_pix: string;
    tipo_pix: string;
    valor: number;
    valor_solicitado: number | null;
    data_solicitacao: string;
    status_item: "APROVADO" | "REVISAO" | "BLOQUEADO";
    motivo_bloqueio: string | null;
}

function fmtDatetime(iso: string): string {
    if (!iso) return "";
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function R(v: number | null) {
    if (v === null || v === undefined) return "—";
    return `R$ ${Number(v).toFixed(2)}`;
}

function StatusBadge({ status }: { status: string }) {
    const cfg: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
        APROVADO: { cls: "badge badge-success", icon: <CheckCircle2 size={12} />, label: "Aprovado" },
        REVISAO: { cls: "badge badge-warning", icon: <AlertTriangle size={12} />, label: "Revisão" },
        BLOQUEADO: { cls: "badge badge-danger", icon: <XCircle size={12} />, label: "Bloqueado" },
    };
    const c = cfg[status] ?? { cls: "badge", icon: null, label: status };
    return <span className={c.cls}>{c.icon} {c.label}</span>;
}

function LoteRow({ lote, isAdmin, onDeleted }: { lote: Lote; isAdmin: boolean; onDeleted: (id: string) => void }) {
    const supabase = createClient();
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<ItemSaque[]>([]);
    const [loading, setLoading] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const loadItems = useCallback(async () => {
        if (items.length > 0) return;
        setLoading(true);
        const { data } = await supabase.from("itens_saque").select("*").eq("lote_id", lote.id).order("status_item");
        setItems((data as ItemSaque[]) ?? []);
        setLoading(false);
    }, [lote.id, items.length, supabase]);

    function toggle() {
        if (!open) loadItems();
        setOpen((v) => !v);
    }

    async function handleDelete() {
        setDeleting(true);
        const { error } = await supabase.from("lotes_saques").delete().eq("id", lote.id);
        if (!error) {
            onDeleted(lote.id);
        } else {
            alert("Erro ao excluir lote: " + error.message);
        }
        setDeleting(false);
        setConfirmDelete(false);
    }

    const approved = items.filter((i) => i.status_item === "APROVADO");
    const blocked = items.filter((i) => i.status_item !== "APROVADO");
    const receita = lote.receita_financeira;

    return (
        <>
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", marginBottom: 12, overflow: "hidden" }}>
                {/* Header */}
                <button
                    onClick={toggle}
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", background: "var(--bg-card)", border: "none", cursor: "pointer", gap: 12 }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <History size={15} color="var(--accent)" />
                        {lote.tipo_saque && (
                            <span style={{ background: "rgba(33,118,255,0.15)", color: "var(--accent)", borderRadius: "var(--radius-sm)", padding: "2px 8px", fontWeight: 700, fontSize: 11, textTransform: "uppercase" }}>
                                {lote.tipo_saque}
                            </span>
                        )}
                        <span style={{ fontWeight: 600, color: "var(--fg)", fontSize: 14 }}>{lote.nome_lote}</span>
                        <span className="badge badge-info" style={{ fontSize: 10 }}>{lote.status}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {receita !== null && (
                            <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(52,211,153,0.1)", borderRadius: "var(--radius-sm)", padding: "4px 10px" }}>
                                <TrendingUp size={13} color="var(--success)" />
                                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--success)" }}>{R(receita)}</span>
                            </div>
                        )}
                        {lote.total_real !== null && (
                            <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>Custo: <strong style={{ color: "var(--fg)" }}>{R(lote.total_real)}</strong></span>
                        )}
                        <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>{fmtDatetime(lote.created_at)}</span>
                        {/* Admin delete button */}
                        {isAdmin && (
                            <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", padding: 4, borderRadius: "var(--radius-sm)", transition: "background 0.15s" }}
                                title="Excluir lote"
                                onMouseOver={(e) => (e.currentTarget.style.background = "rgba(248,113,113,0.1)")}
                                onMouseOut={(e) => (e.currentTarget.style.background = "none")}
                            >
                                <Trash2 size={15} />
                            </button>
                        )}
                        {open ? <ChevronUp size={16} color="var(--fg-muted)" /> : <ChevronDown size={16} color="var(--fg-muted)" />}
                    </div>
                </button>

                {/* Expanded */}
                {open && (
                    <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
                        {loading ? (
                            <p style={{ padding: 24, color: "var(--fg-muted)", fontSize: 14 }}>Carregando itens…</p>
                        ) : items.length === 0 ? (
                            <p style={{ padding: 24, color: "var(--fg-dim)", fontSize: 14 }}>Nenhum item encontrado.</p>
                        ) : (
                            <>
                                {approved.length > 0 && (
                                    <div style={{ padding: "16px 20px" }}>
                                        <h4 style={{ fontSize: 12, fontWeight: 700, color: "var(--success)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                                            ✓ Enviados ao Transfeera ({approved.length})
                                        </h4>
                                        <div style={{ overflowX: "auto" }}>
                                            <table className="data-table">
                                                <thead><tr>
                                                    <th>Trabalhador</th><th>CPF Favorecido</th><th>Tipo PIX</th><th>Chave PIX</th>
                                                    <th>Vlr. Solicitado</th><th>Vlr. Real</th><th>Receita</th>
                                                </tr></thead>
                                                <tbody>
                                                    {approved.map((i) => {
                                                        const rec = i.valor_solicitado !== null ? Number(i.valor_solicitado) - Number(i.valor) : null;
                                                        return (
                                                            <tr key={i.id}>
                                                                <td style={{ fontSize: 12, color: "var(--fg-dim)" }}>{i.nome_usuario || "—"}</td>
                                                                <td className="table-mono">{i.cpf_favorecido}</td>
                                                                <td><span className="badge badge-info">{i.tipo_pix}</span></td>
                                                                <td className="table-mono" style={{ fontSize: 12 }}>{i.chave_pix}</td>
                                                                <td style={{ color: "var(--fg-muted)" }}>{R(i.valor_solicitado)}</td>
                                                                <td style={{ color: "var(--accent)", fontWeight: 600 }}>{R(i.valor)}</td>
                                                                <td style={{ color: "var(--success)", fontWeight: 600 }}>{rec !== null ? R(rec) : "—"}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                                {blocked.length > 0 && (
                                    <div style={{ padding: "16px 20px", borderTop: approved.length > 0 ? "1px solid var(--border)" : undefined }}>
                                        <h4 style={{ fontSize: 12, fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                                            ✗ Barrados / Em Revisão ({blocked.length})
                                        </h4>
                                        <div style={{ overflowX: "auto" }}>
                                            <table className="data-table">
                                                <thead><tr>
                                                    <th>Trabalhador</th><th>CPF Favorecido</th><th>Chave PIX</th><th>Valor Real</th><th>Status</th><th>Motivo</th>
                                                </tr></thead>
                                                <tbody>
                                                    {blocked.map((i) => (
                                                        <tr key={i.id}>
                                                            <td style={{ fontSize: 12, color: "var(--fg-dim)" }}>{i.nome_usuario || "—"}</td>
                                                            <td className="table-mono">{i.cpf_favorecido}</td>
                                                            <td className="table-mono" style={{ fontSize: 12 }}>{i.chave_pix || "—"}</td>
                                                            <td style={{ color: "var(--danger)", fontWeight: 600 }}>{R(i.valor)}</td>
                                                            <td><StatusBadge status={i.status_item} /></td>
                                                            <td style={{ fontSize: 12, color: "var(--fg-muted)", maxWidth: 260 }}>{i.motivo_bloqueio ?? "—"}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Delete confirmation modal */}
            {confirmDelete && (
                <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
                    <div className="modal-container card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header" style={{ borderColor: "var(--danger)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <Trash2 size={20} color="var(--danger)" />
                                <span className="modal-title" style={{ color: "var(--danger)" }}>Excluir Lote</span>
                            </div>
                            <button className="modal-close" onClick={() => setConfirmDelete(false)}><XCircle size={18} /></button>
                        </div>
                        <div className="modal-body">
                            <p style={{ color: "var(--fg)", fontSize: 14, marginBottom: 8 }}>
                                Tem certeza que deseja excluir o lote <strong>{lote.nome_lote}</strong>?
                            </p>
                            <p style={{ color: "var(--fg-muted)", fontSize: 13 }}>
                                Esta ação é irreversível. Todos os itens vinculados ao lote também serão excluídos.
                            </p>
                        </div>
                        <div className="modal-actions" style={{ padding: "16px 24px" }}>
                            <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Cancelar</button>
                            <button
                                className="btn"
                                style={{ background: "var(--danger)", color: "#fff", boxShadow: "0 4px 14px var(--danger-glow)" }}
                                onClick={handleDelete}
                                disabled={deleting}
                            >
                                <Trash2 size={15} /> {deleting ? "Excluindo…" : "Confirmar Exclusão"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default function HistoricoSaques() {
    const supabase = createClient();
    const [lotes, setLotes] = useState<Lote[]>([]);
    const [loading, setLoading] = useState(true);
    const [cargo, setCargo] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            const [{ data: lotesData }, { data: { user } }] = await Promise.all([
                supabase.from("lotes_saques").select("*").order("created_at", { ascending: false }),
                supabase.auth.getUser(),
            ]);
            setLotes((lotesData as Lote[]) ?? []);

            if (user) {
                const { data: perfil } = await supabase
                    .from("usuarios_perfis")
                    .select("cargo")
                    .eq("id", user.id)
                    .single();
                setCargo(perfil?.cargo ?? "USER");
            }
            setLoading(false);
        }
        load();
    }, [supabase]);

    const isAdmin = cargo === "ADMIN";

    function handleDeleted(id: string) {
        setLotes((prev) => prev.filter((l) => l.id !== id));
    }

    const totalReceita = lotes.reduce((s, l) => s + (l.receita_financeira ?? 0), 0);
    const totalReal = lotes.reduce((s, l) => s + (l.total_real ?? 0), 0);

    return (
        <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <History size={20} color="var(--accent)" />
                    <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--fg)" }}>Histórico de Lotes</h2>
                    {isAdmin && (
                        <span style={{ fontSize: 11, color: "var(--danger)", background: "rgba(248,113,113,0.1)", borderRadius: "var(--radius-sm)", padding: "2px 8px", fontWeight: 600 }}>
                            ADMIN
                        </span>
                    )}
                </div>
                {lotes.length > 0 && (
                    <div style={{ display: "flex", gap: 16 }}>
                        <span style={{ fontSize: 13, color: "var(--fg-dim)" }}>
                            Total pago: <strong style={{ color: "var(--accent)" }}>R$ {totalReal.toFixed(2)}</strong>
                        </span>
                        <span style={{ fontSize: 13, color: "var(--fg-dim)" }}>
                            Receita acumulada: <strong style={{ color: "var(--success)" }}>R$ {totalReceita.toFixed(2)}</strong>
                        </span>
                    </div>
                )}
            </div>

            {loading ? (
                <p style={{ color: "var(--fg-muted)", fontSize: 14 }}>Carregando histórico…</p>
            ) : lotes.length === 0 ? (
                <div className="card" style={{ textAlign: "center", padding: 40 }}>
                    <p style={{ color: "var(--fg-dim)", fontSize: 14 }}>Nenhum lote exportado ainda. Os lotes aparecerão aqui após a exportação.</p>
                </div>
            ) : (
                lotes.map((lote) => (
                    <LoteRow key={lote.id} lote={lote} isAdmin={isAdmin} onDeleted={handleDeleted} />
                ))
            )}
        </div>
    );
}
