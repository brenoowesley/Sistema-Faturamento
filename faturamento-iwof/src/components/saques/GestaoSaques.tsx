"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import {
    Upload,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Download,
    AlertOctagon,
    Save,
    X,
    TrendingUp,
    Banknote,
    ArrowDownCircle,
    ChevronDown,
    ChevronUp,
    Filter,
    CloudUpload,
    Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ─── Types ─────────────────────────────────────────────────────────────────────

type PixType = "EMAIL" | "CPF" | "CNPJ" | "CHAVE_ALEATORIA" | "TELEFONE";
type ItemStatus = "APROVADO" | "REVISAO" | "BLOQUEADO";

interface SaqueItem {
    id: string;
    tipo_saque: string;
    data_solicitacao: string;
    cpf_conta: string;
    cpf_favorecido: string;
    nome_usuario: string;
    valor_solicitado: number;
    valor_real: number;
    chave_pix: string;
    tipo_pix: string;
    status: ItemStatus;
    motivo_bloqueio?: string;
    chave_pix_edit?: string;
    tipo_pix_edit?: string;
}

interface LoteLocal {
    tipo_saque: string;
    nome: string;
    items: SaqueItem[];
    activeTab: "APROVADO" | "REVISAO" | "BLOQUEADO";
    expanded: boolean;
    saving: boolean;
    saveMsg: { type: "success" | "error"; text: string } | null;
    sendingApi: boolean;
    apiMsg: { type: "success" | "error"; text: string } | null;
    savedLoteId?: string; // ID do lote salvo no Supabase (para evitar duplicação)
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeCpf(v: string) { return (v ?? "").trim().replace(/[\.\-]/g, ""); }
function sanitizeStr(v: string) { return (v ?? "").trim(); }
function localId() { return crypto.randomUUID(); }

function parseDate(raw: string | number | Date): Date | null {
    if (!raw) return null;
    if (raw instanceof Date) return raw;
    if (typeof raw === "number") {
        const d = XLSX.SSF.parse_date_code(raw);
        if (d) return new Date(d.y, d.m - 1, d.d, d.H, d.M, d.S);
    }
    const s = String(raw).trim();
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return new Date(`${br[3]}-${br[2]}-${br[1]}`);
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d: Date | null): string {
    if (!d) return "";
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function normalizePixType(raw: string): string {
    const map: Record<string, string> = {
        ALEATORIO: "CHAVE_ALEATORIA",
        EVP: "CHAVE_ALEATORIA",
        "CHAVE ALEATÓRIA": "CHAVE_ALEATORIA",
        "CHAVE ALEATORIA": "CHAVE_ALEATORIA",
    };
    const up = (raw ?? "").toUpperCase().trim();
    return map[up] ?? up;
}

/**
 * Detects the correct PIX type from the key format.
 * For 11-digit ambiguity (CPF vs TELEFONE), trusts original type if valid;
 * otherwise compares digits against cpf_favorecido.
 */
function correctPixType(chave: string, tipoOriginal: string, cpfFavorecido: string): string {
    const c = chave.trim();
    if (!c) return tipoOriginal || "";

    // EMAIL: contains @ and a dot after @
    if (c.includes("@") && /\.\w+/.test(c.split("@")[1] ?? "")) return "EMAIL";

    // UUID / CHAVE_ALEATORIA
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c))
        return "CHAVE_ALEATORIA";
    // Long mixed alphanumeric (not a phone / CPF)
    if (/[a-zA-Z]/.test(c) && c.replace(/\-/g, "").length >= 25)
        return "CHAVE_ALEATORIA";

    // Numeric-only analysis
    const digits = c.replace(/[\s\(\)\-\.]/g, "");
    if (/^\d+$/.test(digits)) {
        if (digits.length === 14) return "CNPJ";
        if (digits.length === 10) return "TELEFONE";
        if (digits.length === 11) {
            const top = tipoOriginal.toUpperCase();
            if (top === "CPF" || top === "TELEFONE") return top;
            const cleanCpf = sanitizeCpf(cpfFavorecido);
            return cleanCpf === digits ? "CPF" : "TELEFONE";
        }
    }

    return tipoOriginal || "CHAVE_ALEATORIA";
}

function validateItem(cpf_conta: string, cpf_favorecido: string, chave_pix: string, tipo_pix: string)
    : Pick<SaqueItem, "status" | "motivo_bloqueio"> {
    if (sanitizeCpf(cpf_conta) !== sanitizeCpf(cpf_favorecido))
        return { status: "BLOQUEADO", motivo_bloqueio: "Divergência de CPF entre solicitante e favorecido." };
    const chave = sanitizeStr(chave_pix);
    if (!chave)
        return { status: "BLOQUEADO", motivo_bloqueio: "Chave PIX ausente." };
    const tipo = sanitizeStr(tipo_pix).toUpperCase();
    if (tipo === "EMAIL" && !chave.includes("@"))
        return { status: "REVISAO", motivo_bloqueio: "Tipo PIX é EMAIL mas a chave não contém '@'." };
    if (tipo === "CPF" && /[a-zA-Z]/.test(chave))
        return { status: "REVISAO", motivo_bloqueio: "Tipo PIX é CPF mas a chave contém letras." };
    if (tipo === "TELEFONE") {
        const apenasNumeros = chave.replace(/\D/g, "");
        if (apenasNumeros.length < 10 || apenasNumeros.length > 13) {
            return { status: "REVISAO", motivo_bloqueio: "Telefone parece incompleto ou inválido. Deve conter DDD + Número." };
        }
    }
    if (tipo === "CNPJ" && !/^\d/.test(chave.replace(/[\.\/\-]/g, "")))
        return { status: "REVISAO", motivo_bloqueio: "Tipo PIX é CNPJ mas a chave não parece um CNPJ." };
    return { status: "APROVADO" };
}

function parseRows(rawRows: Record<string, unknown>[]): SaqueItem[] {
    return rawRows
        .filter((r) => r["Chave PIX"] !== undefined || r["Valor Real"] !== undefined)
        .map((r) => {
            const cpf_conta = sanitizeStr(String(r["CPF Solicitante"] ?? ""));
            const cpf_favorecido = sanitizeStr(String(r["CPF Favorecido"] ?? ""));
            const nome_usuario = sanitizeStr(String(r["Trabalhador"] ?? r["Nome"] ?? r["Nome do Usuário"] ?? r["Nome do Usuario"] ?? r["Usuario"] ?? r["Usuário"] ?? ""));
            const chave_pix = sanitizeStr(String(r["Chave PIX"] ?? ""));
            const tipo_pix_raw = normalizePixType(String(r["Tipo de Chave PIX"] ?? ""));
            const tipo_pix = correctPixType(chave_pix, tipo_pix_raw, cpf_favorecido);
            const valor_solicitado = parseFloat(String(r["Valor Solicitado"] ?? "0").replace(",", ".")) || 0;
            const valor_real = parseFloat(String(r["Valor Real"] ?? "0").replace(",", ".")) || 0;
            const tipo_saque = sanitizeStr(String(r["Tipo"] ?? "PADRÃO")).toUpperCase();
            const dateParsed = parseDate(r["Solicitado em"] as string | number | Date);
            const data_solicitacao = dateParsed ? dateParsed.toISOString() : String(r["Solicitado em"] ?? "");
            const validation = validateItem(cpf_conta, cpf_favorecido, chave_pix, tipo_pix);
            return {
                id: localId(),
                tipo_saque,
                data_solicitacao,
                cpf_conta,
                cpf_favorecido,
                nome_usuario,
                valor_solicitado,
                valor_real,
                chave_pix,
                tipo_pix,
                chave_pix_edit: chave_pix,
                tipo_pix_edit: tipo_pix,
                ...validation,
            } as SaqueItem;
        });
}

function buildLoteName(tipo: string, items: SaqueItem[]): string {
    const dates = items.map((i) => parseDate(i.data_solicitacao)).filter(Boolean) as Date[];
    if (dates.length === 0) return `[${tipo}] Novo Lote`;
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    return `[${tipo}] ${fmtDate(min)} a ${fmtDate(max)}`;
}

function groupByTipo(items: SaqueItem[]): LoteLocal[] {
    const map = new Map<string, SaqueItem[]>();
    for (const item of items) {
        if (!map.has(item.tipo_saque)) map.set(item.tipo_saque, []);
        map.get(item.tipo_saque)!.push(item);
    }
    return Array.from(map.entries()).map(([tipo, rows]) => ({
        tipo_saque: tipo,
        nome: buildLoteName(tipo, rows),
        items: rows,
        activeTab: "APROVADO" as const,
        expanded: true,
        saving: false,
        saveMsg: null,
        sendingApi: false,
        apiMsg: null,
    }));
}

function buildTransfeeraXlsx(items: SaqueItem[], filename: string) {
    const approved = items.filter((i) => i.status === "APROVADO");
    const aoa: (string | number)[][] = [
        // Row 1 — warning text merged A1:H1
        ["Mantenha sempre o cabeçalho original da planilha e esta linha, mantendo os titulos e a ordem dos campos", "", "", "", "", "", "", ""],
        // Row 2 — real column headers (8 used by Transfeera)
        ["Tipo de chave", "Chave PIX", "CPF ou CNPJ (opcional)", "Valor", "Email (opcional)", "ID integração (opcional)", "Descrição Pix (opcional)", "Data de agendamento (opcional)"],
        // Row 3+ — data
        ...approved.map((i) => [
            normalizePixType(i.tipo_pix),
            sanitizeStr(i.chave_pix),
            sanitizeStr(i.cpf_favorecido),
            i.valor_real,
            "",
            i.id,
            "REPASSE IWOF",
            ""
        ] as (string | number)[]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Merge A1:H1 (row 0, col 0 → row 0, col 7)
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];

    // Center-align the merged cell
    if (!ws["A1"]) ws["A1"] = { t: "s", v: aoa[0][0] };
    ws["A1"].s = {
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        font: { bold: true },
    };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pagamentos");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function buildExcluidosCsv(items: SaqueItem[]): string {
    const excluded = items.filter((i) => i.status === "BLOQUEADO" || i.status === "REVISAO");
    const header = `CPF Solicitante,CPF Favorecido,Nome,Chave PIX,Tipo PIX,Valor Solicitado,Valor Real,Status,Motivo do Bloqueio`;
    const rows = excluded.map((i) =>
        `${i.cpf_conta},${i.cpf_favorecido},"${i.nome_usuario}",${i.chave_pix},${i.tipo_pix},${i.valor_solicitado},${i.valor_real},${i.status},"${i.motivo_bloqueio ?? ""}"`
    );
    return [header, ...rows].join("\n");
}

function triggerDownload(content: string, filename: string) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

const PIX_TYPE_OPTIONS: PixType[] = ["EMAIL", "CPF", "CNPJ", "CHAVE_ALEATORIA", "TELEFONE"];

// ─── Filter input style ────────────────────────────────────────────────────────

const filterInputStyle: React.CSSProperties = {
    width: "100%",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border-light)",
    borderRadius: "var(--radius-sm)",
    padding: "4px 8px",
    fontSize: 11,
    color: "var(--fg-muted)",
    marginTop: 4,
    outline: "none",
};

// ─── Financial Card ────────────────────────────────────────────────────────────

function FinCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
    return (
        <div style={{
            background: "var(--bg)",
            border: `1px solid ${color}30`,
            borderRadius: "var(--radius-sm)",
            padding: "12px 16px",
            minWidth: 160,
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                {icon}
                <span style={{ fontSize: 11, color: "var(--fg-dim)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
            </div>
            <span style={{ fontSize: 18, fontWeight: 700, color }}>{value < 0 ? "-" : ""}R$ {Math.abs(value).toFixed(2)}</span>
        </div>
    );
}

// ─── Force Approve Modal ───────────────────────────────────────────────────────

function ForcarAprovacaoModal({ item, onConfirm, onClose }: { item: SaqueItem; onConfirm: () => void; onClose: () => void }) {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-container card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
                <div className="modal-header" style={{ borderColor: "var(--danger)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <AlertOctagon size={22} color="var(--danger)" />
                        <span className="modal-title" style={{ color: "var(--danger)" }}>Atenção — Risco Financeiro</span>
                    </div>
                    <button className="modal-close" onClick={onClose}><X size={18} /></button>
                </div>
                <div className="modal-body">
                    <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: "var(--radius-sm)", padding: 16, marginBottom: 16 }}>
                        <p style={{ color: "var(--danger)", fontWeight: 600, marginBottom: 6 }}>Este item foi bloqueado automaticamente:</p>
                        <p style={{ color: "var(--fg-muted)", fontSize: 14 }}>{item.motivo_bloqueio}</p>
                    </div>
                    <p style={{ color: "var(--fg)", fontSize: 14, marginBottom: 8 }}>
                        Ao forçar a aprovação, você assume <strong>total responsabilidade</strong> pelo repasse deste pagamento PIX.
                    </p>
                    <p style={{ color: "var(--fg-muted)", fontSize: 13 }}>
                        Favorecido: <strong>{item.cpf_favorecido}</strong> — Chave: <strong>{item.chave_pix || "(vazia)"}</strong> — Valor Real: <strong>R$ {item.valor_real.toFixed(2)}</strong>
                    </p>
                </div>
                <div className="modal-actions" style={{ padding: "16px 24px" }}>
                    <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
                    <button className="btn" style={{ background: "var(--danger)", color: "#fff", boxShadow: "0 4px 14px var(--danger-glow)" }} onClick={onConfirm}>
                        <AlertOctagon size={16} /> Confirmar Aprovação Forçada
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Tables ────────────────────────────────────────────────────────────────────

function matches(value: string, filter: string): boolean {
    if (!filter) return true;
    return value.toLowerCase().includes(filter.toLowerCase());
}

function AprovadosTable({ items, onUpdateTipoPix }: {
    items: SaqueItem[];
    onUpdateTipoPix: (id: string, tipo: string) => void;
}) {
    const [f, setF] = useState({ data: "", nome: "", cpf: "", tipoPix: "", chavePix: "", vlrSol: "", vlrReal: "" });

    const filtered = items.filter((i) =>
        matches(fmtDate(parseDate(i.data_solicitacao)), f.data) &&
        matches(i.nome_usuario, f.nome) &&
        matches(i.cpf_favorecido, f.cpf) &&
        matches(i.tipo_pix, f.tipoPix) &&
        matches(i.chave_pix, f.chavePix) &&
        matches(i.valor_solicitado.toFixed(2), f.vlrSol) &&
        matches(i.valor_real.toFixed(2), f.vlrReal)
    );

    if (!items.length) return <p className="table-empty">Nenhum item aprovado ainda.</p>;

    const hasFilters = Object.values(f).some(Boolean);

    return (
        <table className="data-table">
            <thead>
                <tr>
                    <th>
                        Data
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.data} onChange={(e) => setF((p) => ({ ...p, data: e.target.value }))} />
                    </th>
                    <th>
                        Nome
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.nome} onChange={(e) => setF((p) => ({ ...p, nome: e.target.value }))} />
                    </th>
                    <th>
                        CPF Favorecido
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.cpf} onChange={(e) => setF((p) => ({ ...p, cpf: e.target.value }))} />
                    </th>
                    <th>
                        Tipo PIX
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.tipoPix} onChange={(e) => setF((p) => ({ ...p, tipoPix: e.target.value }))} />
                    </th>
                    <th>
                        Chave PIX
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.chavePix} onChange={(e) => setF((p) => ({ ...p, chavePix: e.target.value }))} />
                    </th>
                    <th>
                        Vlr. Solicitado
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.vlrSol} onChange={(e) => setF((p) => ({ ...p, vlrSol: e.target.value }))} />
                    </th>
                    <th>
                        Vlr. Real
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.vlrReal} onChange={(e) => setF((p) => ({ ...p, vlrReal: e.target.value }))} />
                    </th>
                    <th>Receita</th>
                </tr>
            </thead>
            <tbody>
                {filtered.map((i) => (
                    <tr key={i.id}>
                        <td className="table-mono">{fmtDate(parseDate(i.data_solicitacao))}</td>
                        <td style={{ fontSize: 12, color: "var(--fg-dim)" }}>{i.nome_usuario || "—"}</td>
                        <td className="table-mono">{i.cpf_favorecido}</td>
                        <td>
                            <select
                                value={i.tipo_pix}
                                onChange={(e) => onUpdateTipoPix(i.id, e.target.value)}
                                style={{
                                    background: "rgba(33,118,255,0.08)",
                                    color: "var(--accent)",
                                    border: "1px solid rgba(33,118,255,0.25)",
                                    borderRadius: 20,
                                    padding: "3px 10px",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                }}
                            >
                                {PIX_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                        </td>
                        <td className="table-mono" style={{ fontSize: 12 }}>{i.chave_pix}</td>
                        <td style={{ color: "var(--fg-muted)" }}>R$ {i.valor_solicitado.toFixed(2)}</td>
                        <td style={{ fontWeight: 600, color: "var(--accent)" }}>R$ {i.valor_real.toFixed(2)}</td>
                        <td style={{ fontWeight: 600, color: "var(--success)" }}>R$ {(i.valor_solicitado - i.valor_real).toFixed(2)}</td>
                    </tr>
                ))}
                {filtered.length === 0 && hasFilters && (
                    <tr><td colSpan={8} style={{ textAlign: "center", padding: 20, color: "var(--fg-dim)", fontSize: 13 }}>
                        <Filter size={14} style={{ marginRight: 6, opacity: 0.5 }} />
                        Nenhum resultado para os filtros aplicados.
                    </td></tr>
                )}
            </tbody>
        </table>
    );
}

function RevisaoTable({ items, onUpdateChave, onUpdateTipo, onSave }: {
    items: SaqueItem[];
    onUpdateChave: (id: string, novaChave: string, cpfFavorecido: string, tipoAtual: string) => void;
    onUpdateTipo: (id: string, novoTipo: string) => void;
    onSave: (id: string) => void;
}) {
    const [f, setF] = useState({ cpf: "", nome: "", tipoPix: "", chavePix: "", vlrReal: "" });

    const filtered = items.filter((i) =>
        matches(i.cpf_favorecido, f.cpf) &&
        matches(i.nome_usuario, f.nome) &&
        matches(i.tipo_pix_edit ?? i.tipo_pix, f.tipoPix) &&
        matches(i.chave_pix_edit ?? i.chave_pix, f.chavePix) &&
        matches(i.valor_real.toFixed(2), f.vlrReal)
    );

    if (!items.length) return <p className="table-empty">Nenhum item para revisar. 🎉</p>;

    const hasFilters = Object.values(f).some(Boolean);

    return (
        <table className="data-table">
            <thead>
                <tr>
                    <th>
                        CPF Favorecido
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.cpf} onChange={(e) => setF((p) => ({ ...p, cpf: e.target.value }))} />
                    </th>
                    <th>
                        Nome
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.nome} onChange={(e) => setF((p) => ({ ...p, nome: e.target.value }))} />
                    </th>
                    <th>
                        Tipo PIX
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.tipoPix} onChange={(e) => setF((p) => ({ ...p, tipoPix: e.target.value }))} />
                    </th>
                    <th>
                        Chave PIX
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.chavePix} onChange={(e) => setF((p) => ({ ...p, chavePix: e.target.value }))} />
                    </th>
                    <th>
                        Vlr. Real
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.vlrReal} onChange={(e) => setF((p) => ({ ...p, vlrReal: e.target.value }))} />
                    </th>
                    <th>Pendência</th>
                    <th>Ação</th>
                </tr>
            </thead>
            <tbody>
                {filtered.map((i) => (
                    <tr key={i.id}>
                        <td className="table-mono">{i.cpf_favorecido}</td>
                        <td style={{ fontSize: 12, color: "var(--fg-dim)" }}>{i.nome_usuario || "—"}</td>
                        <td>
                            <select
                                value={i.tipo_pix_edit ?? i.tipo_pix}
                                onChange={(e) => onUpdateTipo(i.id, e.target.value)}
                                style={{ background: "var(--bg)", color: "var(--fg)", border: "1px solid var(--border-light)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 13 }}
                            >
                                {PIX_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                        </td>
                        <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <input
                                    value={i.chave_pix_edit ?? i.chave_pix}
                                    onChange={(e) => onUpdateChave(i.id, e.target.value, i.cpf_favorecido, i.tipo_pix_edit ?? i.tipo_pix)}
                                    style={{ background: "var(--bg)", color: "var(--fg)", border: "1px solid var(--border-light)", borderRadius: "var(--radius-sm)", padding: "6px 10px", fontSize: 13, width: 220 }}
                                />
                            </div>
                        </td>
                        <td style={{ fontWeight: 600, color: "var(--warning)" }}>R$ {i.valor_real.toFixed(2)}</td>
                        <td><span style={{ fontSize: 12, color: "var(--warning)" }}>{i.motivo_bloqueio}</span></td>
                        <td>
                            <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => onSave(i.id)}>
                                <Save size={13} /> Salvar
                            </button>
                        </td>
                    </tr>
                ))}
                {filtered.length === 0 && hasFilters && (
                    <tr><td colSpan={7} style={{ textAlign: "center", padding: 20, color: "var(--fg-dim)", fontSize: 13 }}>
                        <Filter size={14} style={{ marginRight: 6, opacity: 0.5 }} />
                        Nenhum resultado para os filtros aplicados.
                    </td></tr>
                )}
            </tbody>
        </table>
    );
}

function BloqueadosTable({ items, onForceApprove }: { items: SaqueItem[]; onForceApprove: (i: SaqueItem) => void }) {
    const [f, setF] = useState({ cpfConta: "", cpf: "", nome: "", chavePix: "", vlrReal: "" });

    const filtered = items.filter((i) =>
        matches(i.cpf_conta, f.cpfConta) &&
        matches(i.cpf_favorecido, f.cpf) &&
        matches(i.nome_usuario, f.nome) &&
        matches(i.chave_pix, f.chavePix) &&
        matches(i.valor_real.toFixed(2), f.vlrReal)
    );

    if (!items.length) return <p className="table-empty">Nenhum item bloqueado. ✓</p>;

    const hasFilters = Object.values(f).some(Boolean);

    return (
        <table className="data-table">
            <thead>
                <tr>
                    <th>
                        CPF Solicitante
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.cpfConta} onChange={(e) => setF((p) => ({ ...p, cpfConta: e.target.value }))} />
                    </th>
                    <th>
                        CPF Favorecido
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.cpf} onChange={(e) => setF((p) => ({ ...p, cpf: e.target.value }))} />
                    </th>
                    <th>
                        Nome
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.nome} onChange={(e) => setF((p) => ({ ...p, nome: e.target.value }))} />
                    </th>
                    <th>
                        Chave PIX
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.chavePix} onChange={(e) => setF((p) => ({ ...p, chavePix: e.target.value }))} />
                    </th>
                    <th>
                        Vlr. Real
                        <input style={filterInputStyle} placeholder="filtrar…" value={f.vlrReal} onChange={(e) => setF((p) => ({ ...p, vlrReal: e.target.value }))} />
                    </th>
                    <th>Motivo</th>
                    <th>Ação</th>
                </tr>
            </thead>
            <tbody>
                {filtered.map((i) => (
                    <tr key={i.id}>
                        <td className="table-mono">{i.cpf_conta}</td>
                        <td className="table-mono">{i.cpf_favorecido}</td>
                        <td style={{ fontSize: 12, color: "var(--fg-dim)" }}>{i.nome_usuario || "—"}</td>
                        <td className="table-mono" style={{ fontSize: 12 }}>{i.chave_pix || "—"}</td>
                        <td style={{ fontWeight: 600, color: "var(--danger)" }}>R$ {i.valor_real.toFixed(2)}</td>
                        <td><span style={{ fontSize: 12, color: "var(--danger)" }}>{i.motivo_bloqueio}</span></td>
                        <td>
                            <button
                                className="btn"
                                style={{ padding: "6px 12px", fontSize: 12, background: "rgba(248,113,113,0.12)", color: "var(--danger)", border: "1px solid rgba(248,113,113,0.3)" }}
                                onClick={() => onForceApprove(i)}
                            >
                                <AlertOctagon size={13} /> Forçar Aprovação
                            </button>
                        </td>
                    </tr>
                ))}
                {filtered.length === 0 && hasFilters && (
                    <tr><td colSpan={7} style={{ textAlign: "center", padding: 20, color: "var(--fg-dim)", fontSize: 13 }}>
                        <Filter size={14} style={{ marginRight: 6, opacity: 0.5 }} />
                        Nenhum resultado para os filtros aplicados.
                    </td></tr>
                )}
            </tbody>
        </table>
    );
}

// ─── Lote Panel ────────────────────────────────────────────────────────────────

function LotePanel({
    lote,
    onUpdateLote,
}: {
    lote: LoteLocal;
    onUpdateLote: (tipo: string, updater: (l: LoteLocal) => LoteLocal) => void;
}) {
    const supabase = createClient();
    const [forceApproveItem, setForceApproveItem] = useState<SaqueItem | null>(null);

    const update = (updater: (l: LoteLocal) => LoteLocal) => onUpdateLote(lote.tipo_saque, updater);

    const approved = lote.items.filter((i) => i.status === "APROVADO");
    const revisao = lote.items.filter((i) => i.status === "REVISAO");
    const bloqueados = lote.items.filter((i) => i.status === "BLOQUEADO");

    const totalSolicitado = approved.reduce((s, i) => s + i.valor_solicitado, 0);
    const totalReal = approved.reduce((s, i) => s + i.valor_real, 0);
    const receita = totalSolicitado - totalReal;

    /** Update chave_pix_edit and auto-correct tipo_pix_edit based on the new key */
    function handleUpdateChave(id: string, novaChave: string, cpfFavorecido: string, tipoAtual: string) {
        const autoCorrectedTipo = correctPixType(novaChave, tipoAtual, cpfFavorecido);
        update((l) => ({
            ...l,
            items: l.items.map((i) =>
                i.id === id
                    ? { ...i, chave_pix_edit: novaChave, tipo_pix_edit: autoCorrectedTipo }
                    : i
            ),
        }));
    }

    function handleUpdateTipo(id: string, novoTipo: string) {
        update((l) => ({ ...l, items: l.items.map((i) => i.id === id ? { ...i, tipo_pix_edit: novoTipo } : i) }));
    }

    /** Directly overwrite tipo_pix on an APROVADO item without revalidating */
    function updateAprovadoTipo(id: string, tipo: string) {
        update((l) => ({ ...l, items: l.items.map((i) => i.id === id ? { ...i, tipo_pix: tipo, tipo_pix_edit: tipo } : i) }));
    }

    function saveRevisaoItem(id: string) {
        update((l) => ({
            ...l,
            items: l.items.map((item) => {
                if (item.id !== id) return item;
                const chave = sanitizeStr(item.chave_pix_edit ?? "");
                const tipo = normalizePixType(item.tipo_pix_edit ?? "");
                return { ...item, chave_pix: chave, tipo_pix: tipo, chave_pix_edit: chave, tipo_pix_edit: tipo, ...validateItem(item.cpf_conta, item.cpf_favorecido, chave, tipo) };
            }),
        }));
    }

    function confirmForceApprove() {
        if (!forceApproveItem) return;
        update((l) => ({
            ...l,
            activeTab: "APROVADO",
            items: l.items.map((i) =>
                i.id === forceApproveItem.id
                    ? { ...i, status: "APROVADO" as ItemStatus, motivo_bloqueio: `[FORÇADO] ${i.motivo_bloqueio}` }
                    : i
            ),
        }));
        setForceApproveItem(null);
    }

    async function handleExport() {
        update((l) => ({ ...l, saving: true, saveMsg: null }));
        try {
            const { data: loteDb, error: loteErr } = await supabase
                .from("lotes_saques")
                .insert({
                    nome_lote: lote.nome,
                    tipo_saque: lote.tipo_saque,
                    total_solicitado: totalSolicitado,
                    total_real: totalReal,
                    receita_financeira: receita,
                    status: "Exportado",
                })
                .select()
                .single();
            if (loteErr) throw loteErr;

            const itens = lote.items.map((i) => ({
                id: i.id, // CRÍTICO: Garante que o UUID gerado no parse do Excel seja o mesmo do Banco de Dados
                lote_id: loteDb.id,
                cpf_conta: i.cpf_conta,
                cpf_favorecido: i.cpf_favorecido,
                nome_usuario: i.nome_usuario || null,
                chave_pix: i.chave_pix,
                tipo_pix: i.tipo_pix,
                valor: i.valor_real,
                valor_solicitado: i.valor_solicitado,
                data_solicitacao: i.data_solicitacao || null,
                status_item: i.status,
                motivo_bloqueio: i.motivo_bloqueio ?? null,
            }));
            const { error: itemsErr } = await supabase.from("itens_saque").insert(itens);
            if (itemsErr) throw itemsErr;

            buildTransfeeraXlsx(lote.items, `transfeera_${lote.tipo_saque.replace(/ /g, "_")}.xlsx`);
            update((l) => ({ ...l, saving: false, saveMsg: { type: "success", text: `Lote salvo! ${approved.length} aprovado(s) exportados.` } }));
        } catch (err: unknown) {
            const e = err as { message?: string };
            update((l) => ({ ...l, saving: false, saveMsg: { type: "error", text: e.message ?? "Erro ao salvar." } }));
        }
    }

    async function handleDirectIntegration() {
        update((l) => ({ ...l, sendingApi: true, apiMsg: null }));
        try {
            // ── Passo 1: Salvar no Supabase (idêntico ao handleExport) ──
            let loteDbId = lote.savedLoteId;

            if (!loteDbId) {
                const { data: loteDb, error: loteErr } = await supabase
                    .from("lotes_saques")
                    .insert({
                        nome_lote: lote.nome,
                        tipo_saque: lote.tipo_saque,
                        total_solicitado: totalSolicitado,
                        total_real: totalReal,
                        receita_financeira: receita,
                        status: "Enviado API",
                    })
                    .select()
                    .single();
                if (loteErr) throw loteErr;
                loteDbId = loteDb.id;

                const itens = lote.items.map((i) => ({
                    id: i.id,
                    lote_id: loteDbId,
                    cpf_conta: i.cpf_conta,
                    cpf_favorecido: i.cpf_favorecido,
                    nome_usuario: i.nome_usuario || null,
                    chave_pix: i.chave_pix,
                    tipo_pix: i.tipo_pix,
                    valor: i.valor_real,
                    valor_solicitado: i.valor_solicitado,
                    data_solicitacao: i.data_solicitacao || null,
                    status_item: i.status,
                    motivo_bloqueio: i.motivo_bloqueio ?? null,
                }));
                const { error: itemsErr } = await supabase.from("itens_saque").insert(itens);
                if (itemsErr) throw itemsErr;

                update((l) => ({ ...l, savedLoteId: loteDbId }));
            }

            // ── Passo 2: Enviar para a API Transfeera ──
            const apiPayload = {
                action: "create_batch",
                lote_nome: lote.nome,
                items: approved.map((i) => ({
                    id: i.id,
                    valor_real: i.valor_real,
                    tipo_pix: i.tipo_pix,
                    chave_pix: i.chave_pix,
                    cpf_favorecido: i.cpf_favorecido,
                    nome_usuario: i.nome_usuario,
                })),
            };

            const res = await fetch("/api/transfeera", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(apiPayload),
            });

            const data = await res.json();

            if (!res.ok) {
                // Extrair erros da API
                let errorMsg = data.error || "Erro desconhecido da Transfeera.";
                if (data.transferErrors && data.transferErrors.length > 0) {
                    errorMsg += "\n" + data.transferErrors.slice(0, 5).join("\n");
                }
                throw new Error(errorMsg);
            }

            // ── Passo 3: Salvar IDs da Transfeera no Supabase ──
            const batchId: string = data.batch_id;
            const transferIdMap: Record<string, string> = data.transferIdMap || {};

            // Atualizar lote com transfeera_batch_id
            await supabase
                .from("lotes_saques")
                .update({ transfeera_batch_id: batchId })
                .eq("id", loteDbId);

            console.log(`[GestaoSaques] 🔍 IDs recebidos da Transfeera:`, transferIdMap);

            // Atualizar cada item com transfeera_transfer_id em massa (Bulk Update)
            const upsertData = Object.entries(transferIdMap).map(([id, tid]) => ({
                id: id.toLowerCase(), // Garantir que está no formato esperado pelo UUID
                transfeera_transfer_id: tid
            }));

            console.log(`[GestaoSaques] 📝 Tentando Bulk Upsert em ${upsertData.length} itens...`);

            if (upsertData.length > 0) {
                const { data: upsertResult, error: upsertErr } = await supabase
                    .from("itens_saque")
                    .upsert(upsertData, { onConflict: "id" })
                    .select(); // Adicionado select() para ver o que foi afetado
                
                if (upsertErr) {
                    console.error("[GestaoSaques] ❌ Erro no bulk upsert:", upsertErr);
                } else {
                    console.log(`[GestaoSaques] ✅ Bulk Upsert concluído. Linhas afetadas: ${upsertResult?.length || 0}`);
                }
            }

            const mappedCount = Object.keys(transferIdMap).length;
            update((l) => ({
                ...l,
                sendingApi: false,
                apiMsg: {
                    type: "success",
                    text: `✅ Lote enviado com sucesso! Batch ID: ${batchId} | ${mappedCount} transferência(s) mapeada(s). Acompanhe em Saques → Acompanhamento.`,
                },
            }));
        } catch (err: unknown) {
            const e = err as { message?: string };
            update((l) => ({
                ...l,
                sendingApi: false,
                apiMsg: { type: "error", text: e.message ?? "Erro ao enviar lote para a Transfeera." },
            }));
        }
    }

    function handleDownloadExcluidos() {
        triggerDownload(buildExcluidosCsv(lote.items), `excluidos_${lote.tipo_saque.replace(/ /g, "_")}.csv`);
    }

    const tabColor = { APROVADO: "var(--success)", REVISAO: "var(--warning)", BLOQUEADO: "var(--danger)" };

    return (
        <>
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", marginBottom: 20, overflow: "hidden" }}>
                {/* ── Panel Header ── */}
                <div style={{ background: "var(--bg-card)", padding: "16px 20px" }}>
                    {/* Top row: type badge + toggle */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{
                                background: "rgba(33,118,255,0.15)", color: "var(--accent)",
                                borderRadius: "var(--radius-sm)", padding: "4px 12px", fontWeight: 700, fontSize: 12,
                                textTransform: "uppercase", letterSpacing: 0.8,
                            }}>
                                {lote.tipo_saque}
                            </span>
                            <span style={{ fontSize: 13, color: "var(--fg-dim)" }}>{lote.items.length} item(s)</span>
                        </div>
                        <button
                            onClick={() => update((l) => ({ ...l, expanded: !l.expanded }))}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--fg-muted)" }}
                        >
                            {lote.expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        </button>
                    </div>

                    {/* Batch name input */}
                    <div style={{ marginBottom: 14 }}>
                        <label style={{ fontSize: 11, color: "var(--fg-dim)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>Nome do Lote</label>
                        <input
                            className="input"
                            style={{ marginTop: 4, paddingLeft: 14 }}
                            value={lote.nome}
                            onChange={(e) => update((l) => ({ ...l, nome: e.target.value }))}
                        />
                    </div>

                    {/* Financial summary */}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                        <FinCard label="Valor Solicitado" value={totalSolicitado} color="var(--fg-muted)" icon={<Banknote size={13} color="var(--fg-muted)" />} />
                        <FinCard label="Valor Real (Custo)" value={totalReal} color="var(--accent)" icon={<ArrowDownCircle size={13} color="var(--accent)" />} />
                        <FinCard label="Receita Financeira" value={receita} color="var(--success)" icon={<TrendingUp size={13} color="var(--success)" />} />
                    </div>

                    {/* Count pills + action buttons */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <span className="badge badge-success"><CheckCircle2 size={12} /> {approved.length} Aprovados</span>
                            <span className="badge badge-warning"><AlertTriangle size={12} /> {revisao.length} Revisão</span>
                            <span className="badge badge-danger"><XCircle size={12} /> {bloqueados.length} Excluídos</span>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            {(bloqueados.length > 0 || revisao.length > 0) && (
                                <button className="btn btn-ghost" style={{ fontSize: 12, padding: "8px 14px" }} onClick={handleDownloadExcluidos}>
                                    <XCircle size={13} /> Baixar Excluídos
                                </button>
                            )}
                            <button
                                className="btn btn-primary"
                                style={{ fontSize: 13, padding: "8px 18px" }}
                                onClick={handleExport}
                                disabled={lote.saving || lote.sendingApi || approved.length === 0 || lote.saveMsg?.type === "success" || lote.apiMsg?.type === "success"}
                            >
                                <Download size={14} />
                                {lote.saving ? "Salvando…" : "Exportar Transfeera"}
                            </button>
                            <button
                                className="btn"
                                style={{
                                    fontSize: 13,
                                    padding: "8px 18px",
                                    background: "rgba(52,211,153,0.15)",
                                    color: "var(--success)",
                                    border: "1px solid rgba(52,211,153,0.3)",
                                }}
                                onClick={handleDirectIntegration}
                                disabled={lote.saving || lote.sendingApi || approved.length === 0 || lote.apiMsg?.type === "success"}
                            >
                                {lote.sendingApi ? (
                                    <><Loader2 size={14} className="animate-spin" /> Enviando…</>
                                ) : (
                                    <><CloudUpload size={14} /> Enviar Lote Direto (API)</>
                                )}
                            </button>
                        </div>
                    </div>

                    {lote.saveMsg && (
                        <div style={{
                            marginTop: 10, padding: "8px 12px", borderRadius: "var(--radius-sm)", fontSize: 13,
                            background: lote.saveMsg.type === "success" ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
                            color: lote.saveMsg.type === "success" ? "var(--success)" : "var(--danger)",
                            border: `1px solid ${lote.saveMsg.type === "success" ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`,
                        }}>
                            {lote.saveMsg.text}
                        </div>
                    )}
                    {lote.apiMsg && (
                        <div style={{
                            marginTop: 10, padding: "8px 12px", borderRadius: "var(--radius-sm)", fontSize: 13,
                            background: lote.apiMsg.type === "success" ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
                            color: lote.apiMsg.type === "success" ? "var(--success)" : "var(--danger)",
                            border: `1px solid ${lote.apiMsg.type === "success" ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`,
                            whiteSpace: "pre-wrap",
                        }}>
                            {lote.apiMsg.text}
                        </div>
                    )}
                </div>

                {/* ── Panel Body (Tabs + Tables) ── */}
                {lote.expanded && (
                    <div style={{ borderTop: "1px solid var(--border)" }}>
                        <div className="tabs" style={{ padding: "0 20px", background: "var(--bg-card)" }}>
                            {([
                                { key: "APROVADO", label: `Aprovados (${approved.length})` },
                                { key: "REVISAO", label: `Revisão (${revisao.length})` },
                                { key: "BLOQUEADO", label: `Excluídos (${bloqueados.length})` },
                            ] as const).map((t) => (
                                <button
                                    key={t.key}
                                    className={`tab ${lote.activeTab === t.key ? "tab-active" : ""}`}
                                    style={lote.activeTab === t.key ? { color: tabColor[t.key], borderBottomColor: tabColor[t.key] } : {}}
                                    onClick={() => update((l) => ({ ...l, activeTab: t.key }))}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                        <div style={{ overflowX: "auto" }}>
                            {lote.activeTab === "APROVADO" && <AprovadosTable items={approved} onUpdateTipoPix={updateAprovadoTipo} />}
                            {lote.activeTab === "REVISAO" && (
                                <RevisaoTable
                                    items={revisao}
                                    onUpdateChave={handleUpdateChave}
                                    onUpdateTipo={handleUpdateTipo}
                                    onSave={saveRevisaoItem}
                                />
                            )}
                            {lote.activeTab === "BLOQUEADO" && <BloqueadosTable items={bloqueados} onForceApprove={setForceApproveItem} />}
                        </div>
                    </div>
                )}
            </div>

            {forceApproveItem && (
                <ForcarAprovacaoModal item={forceApproveItem} onConfirm={confirmForceApprove} onClose={() => setForceApproveItem(null)} />
            )}
        </>
    );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function GestaoSaques() {
    const [lotes, setLotes] = useState<LoteLocal[]>([]);
    const [fileName, setFileName] = useState<string | null>(null);

    const onDrop = useCallback((accepted: File[]) => {
        const file = accepted[0];
        if (!file) return;
        setFileName(file.name);

        if (file.name.endsWith(".csv")) {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete(results) {
                    setLotes(groupByTipo(parseRows(results.data as Record<string, unknown>[])));
                },
            });
        } else {
            const reader = new FileReader();
            reader.onload = (e) => {
                const wb = XLSX.read(e.target?.result, { type: "array", cellDates: false });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
                setLotes(groupByTipo(parseRows(raw)));
            };
            reader.readAsArrayBuffer(file);
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            "text/csv": [".csv"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
            "application/vnd.ms-excel": [".xls"],
        },
        multiple: false,
    });

    function updateLote(tipo: string, updater: (l: LoteLocal) => LoteLocal) {
        setLotes((prev) => prev.map((l) => l.tipo_saque === tipo ? updater(l) : l));
    }

    // ── Empty state ──
    if (lotes.length === 0) {
        return (
            <div className="card">
                <div
                    {...getRootProps()}
                    className={`dropzone ${isDragActive ? "dropzone-active" : ""}`}
                    style={{ paddingTop: 60, paddingBottom: 60 }}
                >
                    <input {...getInputProps()} />
                    <Upload size={40} color="var(--accent)" style={{ opacity: 0.9 }} />
                    <p style={{ fontWeight: 600, fontSize: 16, color: "var(--fg)", marginTop: 8 }}>
                        {isDragActive ? "Solte o arquivo aqui…" : "Arraste ou clique para importar a planilha"}
                    </p>
                    <p style={{ fontSize: 13, color: "var(--fg-muted)" }}>
                        CSV / XLSX — colunas: &quot;Tipo&quot;, &quot;Solicitado em&quot;, &quot;CPF Solicitante&quot;, &quot;CPF Favorecido&quot;, &quot;Nome&quot;, &quot;Valor Solicitado&quot;, &quot;Valor Real&quot;, &quot;Chave PIX&quot;, &quot;Tipo de Chave PIX&quot;
                    </p>
                </div>
            </div>
        );
    }

    return (
        <>
            {/* Reset bar */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <p style={{ fontSize: 13, color: "var(--fg-dim)" }}>
                    <strong style={{ color: "var(--fg)" }}>{fileName}</strong> — {lotes.reduce((s, l) => s + l.items.length, 0)} linha(s) • {lotes.length} lote(s) detectado(s)
                </p>
                <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => { setLotes([]); setFileName(null); }}>
                    <Upload size={14} /> Novo Upload
                </button>
            </div>

            {lotes.map((lote) => (
                <LotePanel key={lote.tipo_saque} lote={lote} onUpdateLote={updateLote} />
            ))}
        </>
    );
}
