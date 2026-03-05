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
    ChevronDown,
    ChevronUp,
    X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

type PixType = "EMAIL" | "CPF" | "CNPJ" | "CHAVE_ALEATORIA" | "TELEFONE";
type ItemStatus = "APROVADO" | "REVISAO" | "BLOQUEADO";

interface SaqueItem {
    id: string; // local uuid
    data_solicitacao: string;
    cpf_conta: string;
    cpf_favorecido: string;
    valor_real: number;
    chave_pix: string;
    tipo_pix: string;
    status: ItemStatus;
    motivo_bloqueio?: string;
    // editable fields (for REVISAO tab)
    chave_pix_edit?: string;
    tipo_pix_edit?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeCpf(v: string): string {
    return (v ?? "").trim().replace(/[\.\-]/g, "");
}

function sanitizeStr(v: string): string {
    return (v ?? "").trim();
}

function localId(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function parseDate(raw: string | number | Date): Date | null {
    if (!raw) return null;
    if (raw instanceof Date) return raw;
    if (typeof raw === "number") {
        // Excel serial
        const d = XLSX.SSF.parse_date_code(raw);
        if (d) return new Date(d.y, d.m - 1, d.d, d.H, d.M, d.S);
    }
    const s = String(raw).trim();
    // DD/MM/YYYY or DD/MM/YYYY HH:mm:ss
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return new Date(`${br[3]}-${br[2]}-${br[1]}`);
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d: Date | null): string {
    if (!d) return "";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function validateItem(
    cpf_conta: string,
    cpf_favorecido: string,
    chave_pix: string,
    tipo_pix: string
): Pick<SaqueItem, "status" | "motivo_bloqueio"> {
    const cpfA = sanitizeCpf(cpf_conta);
    const cpfB = sanitizeCpf(cpf_favorecido);

    // Rule 1: divergência de CPF
    if (cpfA !== cpfB) {
        return { status: "BLOQUEADO", motivo_bloqueio: "Divergência de CPF entre solicitante e favorecido." };
    }
    // Rule 2: chave PIX ausente
    const chave = sanitizeStr(chave_pix);
    if (!chave) {
        return { status: "BLOQUEADO", motivo_bloqueio: "Chave PIX ausente." };
    }
    // Rule 3: inconsistência tipo × chave
    const tipo = sanitizeStr(tipo_pix).toUpperCase();
    if (tipo === "EMAIL" && !chave.includes("@")) {
        return { status: "REVISAO", motivo_bloqueio: "Tipo PIX é EMAIL mas a chave não contém '@'." };
    }
    if (tipo === "CPF" && /[a-zA-Z]/.test(chave)) {
        return { status: "REVISAO", motivo_bloqueio: "Tipo PIX é CPF mas a chave contém letras." };
    }
    if (tipo === "TELEFONE" && !/^\+?\d[\d\s\-\(\)]+$/.test(chave)) {
        return { status: "REVISAO", motivo_bloqueio: "Tipo PIX é TELEFONE mas o formato é inválido." };
    }
    if (tipo === "CNPJ" && !/^\d/.test(chave.replace(/[\.\-\/]/g, ""))) {
        return { status: "REVISAO", motivo_bloqueio: "Tipo PIX é CNPJ mas a chave não parece um CNPJ." };
    }
    return { status: "APROVADO" };
}

function normalizePixType(raw: string): string {
    const map: Record<string, string> = {
        ALEATORIO: "CHAVE_ALEATORIA",
        "CHAVE ALEATÓRIA": "CHAVE_ALEATORIA",
        "CHAVE ALEATORIA": "CHAVE_ALEATORIA",
        EVP: "CHAVE_ALEATORIA",
    };
    const up = (raw ?? "").toUpperCase().trim();
    return map[up] ?? up;
}

function parseRows(rawRows: Record<string, unknown>[]): SaqueItem[] {
    return rawRows
        .filter((r) => {
            const chave = r["Chave PIX"] ?? r["chave_pix"];
            const valor = r["Valor Real"] ?? r["valor_real"];
            return chave !== undefined || valor !== undefined;
        })
        .map((r) => {
            const cpf_conta = sanitizeStr(String(r["CPF Solicitante"] ?? r["cpf_conta"] ?? ""));
            const cpf_favorecido = sanitizeStr(String(r["CPF Favorecido"] ?? r["cpf_favorecido"] ?? ""));
            const chave_pix = sanitizeStr(String(r["Chave PIX"] ?? r["chave_pix"] ?? ""));
            const tipo_pix_raw = sanitizeStr(String(r["Tipo de Chave PIX"] ?? r["tipo_pix"] ?? ""));
            const tipo_pix = normalizePixType(tipo_pix_raw);
            const valor_raw = String(r["Valor Real"] ?? r["valor_real"] ?? "0").replace(",", ".");
            const valor_real = parseFloat(valor_raw) || 0;
            const data_raw = r["Solicitado em"] ?? r["data_solicitacao"] ?? "";
            const dateParsed = parseDate(data_raw as string | number | Date);
            const data_solicitacao = dateParsed ? dateParsed.toISOString() : String(data_raw);

            const validation = validateItem(cpf_conta, cpf_favorecido, chave_pix, tipo_pix);

            return {
                id: localId(),
                data_solicitacao,
                cpf_conta,
                cpf_favorecido,
                valor_real,
                chave_pix,
                tipo_pix,
                chave_pix_edit: chave_pix,
                tipo_pix_edit: tipo_pix,
                ...validation,
            } as SaqueItem;
        });
}

function buildBatchName(items: SaqueItem[]): string {
    const dates = items
        .map((i) => parseDate(i.data_solicitacao))
        .filter(Boolean) as Date[];
    if (dates.length === 0) return "Novo Lote";
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    return `${fmtDate(min)} a ${fmtDate(max)}`;
}

function buildTransfeeraCsv(items: SaqueItem[]): string {
    const approved = items.filter((i) => i.status === "APROVADO");
    const header = `"Mantenha sempre o cabeçalho original da planilha e esta linha, mantendo os titulos e a ordem dos campos",,,,,,,`;
    const colHeaders = `Tipo de chave,Chave PIX,CPF ou CNPJ (opcional),Valor,Email (opcional),ID integração (opcional),Descrição Pix (opcional),Data de agendamento (opcional)`;
    const rows = approved.map((item) => {
        const tipo = normalizePixType(item.tipo_pix);
        const chave = sanitizeStr(item.chave_pix);
        const cpf = sanitizeStr(item.cpf_favorecido);
        return `${tipo},${chave},${cpf},${item.valor_real},,,"REPASSE IWOF",`;
    });
    return [header, colHeaders, ...rows].join("\n");
}

const PIX_TYPE_OPTIONS: PixType[] = ["EMAIL", "CPF", "CNPJ", "CHAVE_ALEATORIA", "TELEFONE"];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ItemStatus }) {
    const cfg = {
        APROVADO: { cls: "badge badge-success", label: "✓ Aprovado" },
        REVISAO: { cls: "badge badge-warning", label: "⚠ Revisão" },
        BLOQUEADO: { cls: "badge badge-danger", label: "✗ Bloqueado" },
    }[status];
    return <span className={cfg.cls}>{cfg.label}</span>;
}

function ForcarAprovacaoModal({
    item,
    onConfirm,
    onClose,
}: {
    item: SaqueItem;
    onConfirm: () => void;
    onClose: () => void;
}) {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-container card"
                style={{ maxWidth: 480 }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header" style={{ borderColor: "var(--danger)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <AlertOctagon size={22} color="var(--danger)" />
                        <span className="modal-title" style={{ color: "var(--danger)" }}>
                            Atenção — Risco Financeiro
                        </span>
                    </div>
                    <button className="modal-close" onClick={onClose}><X size={18} /></button>
                </div>
                <div className="modal-body">
                    <div
                        style={{
                            background: "rgba(248,113,113,0.08)",
                            border: "1px solid rgba(248,113,113,0.25)",
                            borderRadius: "var(--radius-sm)",
                            padding: 16,
                            marginBottom: 16,
                        }}
                    >
                        <p style={{ color: "var(--danger)", fontWeight: 600, marginBottom: 6 }}>
                            Este item foi bloqueado automaticamente:
                        </p>
                        <p style={{ color: "var(--fg-muted)", fontSize: 14 }}>{item.motivo_bloqueio}</p>
                    </div>
                    <p style={{ color: "var(--fg)", fontSize: 14, marginBottom: 8 }}>
                        Ao forçar a aprovação, você assume <strong>total responsabilidade</strong> pelo repasse deste pagamento PIX. A operação será registrada no histórico do lote.
                    </p>
                    <p style={{ color: "var(--fg-muted)", fontSize: 13 }}>
                        Favorecido: <strong>{item.cpf_favorecido}</strong> — Chave: <strong>{item.chave_pix || "(vazia)"}</strong> — Valor: <strong>R$ {item.valor_real.toFixed(2)}</strong>
                    </p>
                </div>
                <div className="modal-actions" style={{ padding: "16px 24px" }}>
                    <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
                    <button
                        className="btn"
                        style={{ background: "var(--danger)", color: "#fff", boxShadow: "0 4px 14px var(--danger-glow)" }}
                        onClick={onConfirm}
                    >
                        <AlertOctagon size={16} />
                        Confirmar Aprovação Forçada
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GestaoSaques() {
    const supabase = createClient();

    const [items, setItems] = useState<SaqueItem[]>([]);
    const [batchName, setBatchName] = useState("");
    const [activeTab, setActiveTab] = useState<"APROVADO" | "REVISAO" | "BLOQUEADO">("APROVADO");
    const [forceApproveItem, setForceApproveItem] = useState<SaqueItem | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [fileName, setFileName] = useState<string | null>(null);

    // ── Dropzone ──
    const onDrop = useCallback((accepted: File[]) => {
        const file = accepted[0];
        if (!file) return;
        setFileName(file.name);
        setSaveMsg(null);

        if (file.name.endsWith(".csv")) {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete(results) {
                    const rows = parseRows(results.data as Record<string, unknown>[]);
                    setItems(rows);
                    setBatchName(buildBatchName(rows));
                },
            });
        } else {
            const reader = new FileReader();
            reader.onload = (e) => {
                const data = e.target?.result;
                const wb = XLSX.read(data, { type: "array", cellDates: false });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
                const rows = parseRows(rawRows);
                setItems(rows);
                setBatchName(buildBatchName(rows));
            };
            reader.readAsArrayBuffer(file);
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { "text/csv": [".csv"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel": [".xls"] },
        multiple: false,
    });

    // ── Computed lists ──
    const approved = items.filter((i) => i.status === "APROVADO");
    const revisao = items.filter((i) => i.status === "REVISAO");
    const bloqueados = items.filter((i) => i.status === "BLOQUEADO");

    // ── Inline edit for REVISAO ──
    function updateEditField(id: string, field: "chave_pix_edit" | "tipo_pix_edit", value: string) {
        setItems((prev) => prev.map((item) => item.id === id ? { ...item, [field]: value } : item));
    }

    function saveRevisaoItem(id: string) {
        setItems((prev) =>
            prev.map((item) => {
                if (item.id !== id) return item;
                const chave = sanitizeStr(item.chave_pix_edit ?? "");
                const tipo = normalizePixType(item.tipo_pix_edit ?? "");
                const validation = validateItem(item.cpf_conta, item.cpf_favorecido, chave, tipo);
                return {
                    ...item,
                    chave_pix: chave,
                    tipo_pix: tipo,
                    chave_pix_edit: chave,
                    tipo_pix_edit: tipo,
                    ...validation,
                };
            })
        );
    }

    // ── Force approve ──
    function confirmForceApprove() {
        if (!forceApproveItem) return;
        setItems((prev) =>
            prev.map((i) =>
                i.id === forceApproveItem.id
                    ? { ...i, status: "APROVADO", motivo_bloqueio: `[FORÇADO] ${i.motivo_bloqueio}` }
                    : i
            )
        );
        setForceApproveItem(null);
        setActiveTab("APROVADO");
    }

    // ── Export CSV ──
    function downloadCsv() {
        const csv = buildTransfeeraCsv(items);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `transfeera_${batchName.replace(/\//g, "-").replace(/ /g, "_")}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── Save + Export ──
    async function handleExportAndSave() {
        setSaving(true);
        setSaveMsg(null);
        try {
            // 1. Save lote
            const { data: lote, error: loteErr } = await supabase
                .from("lotes_saques")
                .insert({ nome_lote: batchName, status: "Exportado" })
                .select()
                .single();

            if (loteErr) throw loteErr;

            // 2. Save items
            const itens = items.map((i) => ({
                lote_id: lote.id,
                cpf_conta: i.cpf_conta,
                cpf_favorecido: i.cpf_favorecido,
                chave_pix: i.chave_pix,
                tipo_pix: i.tipo_pix,
                valor: i.valor_real,
                data_solicitacao: i.data_solicitacao || null,
                status_item: i.status,
                motivo_bloqueio: i.motivo_bloqueio ?? null,
            }));

            const { error: itemsErr } = await supabase.from("itens_saque").insert(itens);
            if (itemsErr) throw itemsErr;

            // 3. Download CSV
            downloadCsv();
            setSaveMsg({ type: "success", text: `Lote "${batchName}" salvo com ${approved.length} aprovado(s). CSV gerado!` });
        } catch (err: unknown) {
            const e = err as { message?: string };
            setSaveMsg({ type: "error", text: e.message ?? "Erro ao salvar lote." });
        } finally {
            setSaving(false);
        }
    }

    // ── Render ──────────────────────────────────────────────────────────────────

    if (items.length === 0) {
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
                        Aceita CSV e XLSX — colunas: "Solicitado em", "CPF Solicitante", "CPF Favorecido", "Valor Real", "Chave PIX", "Tipo de Chave PIX"
                    </p>
                </div>
            </div>
        );
    }

    const totalVal = approved.reduce((s, i) => s + i.valor_real, 0);

    return (
        <>
            {/* Batch header */}
            <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 12, color: "var(--fg-dim)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
                            Nome do Lote
                        </label>
                        <input
                            className="input"
                            style={{ marginTop: 4, paddingLeft: 14 }}
                            value={batchName}
                            onChange={(e) => setBatchName(e.target.value)}
                        />
                    </div>

                    {/* Summary pills */}
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <div className="badge badge-success" style={{ fontSize: 13, padding: "6px 14px" }}>
                            <CheckCircle2 size={14} /> {approved.length} Aprovados • R$ {totalVal.toFixed(2)}
                        </div>
                        <div className="badge badge-warning" style={{ fontSize: 13, padding: "6px 14px" }}>
                            <AlertTriangle size={14} /> {revisao.length} Revisão
                        </div>
                        <div className="badge badge-danger" style={{ fontSize: 13, padding: "6px 14px" }}>
                            <XCircle size={14} /> {bloqueados.length} Excluídos
                        </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 10 }}>
                        <button
                            className="btn btn-ghost"
                            onClick={() => { setItems([]); setFileName(null); setSaveMsg(null); }}
                            style={{ fontSize: 13 }}
                        >
                            <Upload size={15} /> Novo Upload
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={handleExportAndSave}
                            disabled={saving || approved.length === 0}
                        >
                            <Download size={15} />
                            {saving ? "Salvando…" : "Fechar e Exportar Lote"}
                        </button>
                    </div>
                </div>

                {fileName && (
                    <p style={{ fontSize: 12, color: "var(--fg-dim)", marginTop: 10 }}>
                        Arquivo: <strong>{fileName}</strong> — {items.length} linha(s) lida(s)
                    </p>
                )}

                {saveMsg && (
                    <div
                        style={{
                            marginTop: 12,
                            padding: "10px 14px",
                            borderRadius: "var(--radius-sm)",
                            background: saveMsg.type === "success" ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
                            color: saveMsg.type === "success" ? "var(--success)" : "var(--danger)",
                            fontSize: 13,
                            border: `1px solid ${saveMsg.type === "success" ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`,
                        }}
                    >
                        {saveMsg.text}
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div className="tabs" style={{ padding: "0 24px" }}>
                    {([
                        { key: "APROVADO", label: `Aprovados (${approved.length})`, color: "var(--success)" },
                        { key: "REVISAO", label: `Revisão (${revisao.length})`, color: "var(--warning)" },
                        { key: "BLOQUEADO", label: `Excluídos (${bloqueados.length})`, color: "var(--danger)" },
                    ] as const).map((t) => (
                        <button
                            key={t.key}
                            className={`tab ${activeTab === t.key ? "tab-active" : ""}`}
                            style={activeTab === t.key ? { color: t.color, borderBottomColor: t.color } : {}}
                            onClick={() => setActiveTab(t.key)}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                <div style={{ overflowX: "auto" }}>
                    {activeTab === "APROVADO" && <AprovadosTable items={approved} />}
                    {activeTab === "REVISAO" && (
                        <RevisaoTable
                            items={revisao}
                            onUpdateField={updateEditField}
                            onSave={saveRevisaoItem}
                        />
                    )}
                    {activeTab === "BLOQUEADO" && (
                        <BloqueadosTable
                            items={bloqueados}
                            onForceApprove={setForceApproveItem}
                        />
                    )}
                </div>
            </div>

            {/* Force approve modal */}
            {forceApproveItem && (
                <ForcarAprovacaoModal
                    item={forceApproveItem}
                    onConfirm={confirmForceApprove}
                    onClose={() => setForceApproveItem(null)}
                />
            )}
        </>
    );
}

// ─── Table sub-components ─────────────────────────────────────────────────────

function AprovadosTable({ items }: { items: SaqueItem[] }) {
    if (items.length === 0) {
        return <p className="table-empty">Nenhum item aprovado ainda.</p>;
    }
    return (
        <table className="data-table">
            <thead>
                <tr>
                    <th>Data Solicitação</th>
                    <th>CPF Favorecido</th>
                    <th>Tipo PIX</th>
                    <th>Chave PIX</th>
                    <th>Valor</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                {items.map((item) => (
                    <tr key={item.id}>
                        <td className="table-mono">{fmtDate(parseDate(item.data_solicitacao))}</td>
                        <td className="table-mono">{item.cpf_favorecido}</td>
                        <td><span className="badge badge-info">{item.tipo_pix}</span></td>
                        <td className="table-mono" style={{ fontSize: 13 }}>{item.chave_pix}</td>
                        <td style={{ fontWeight: 600, color: "var(--success)" }}>R$ {item.valor_real.toFixed(2)}</td>
                        <td><StatusBadge status={item.status} /></td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function RevisaoTable({
    items,
    onUpdateField,
    onSave,
}: {
    items: SaqueItem[];
    onUpdateField: (id: string, field: "chave_pix_edit" | "tipo_pix_edit", value: string) => void;
    onSave: (id: string) => void;
}) {
    if (items.length === 0) {
        return <p className="table-empty">Nenhum item para revisar. 🎉</p>;
    }
    return (
        <table className="data-table">
            <thead>
                <tr>
                    <th>Data Solicitação</th>
                    <th>CPF Favorecido</th>
                    <th>Tipo PIX</th>
                    <th>Chave PIX</th>
                    <th>Valor</th>
                    <th>Pendência</th>
                    <th>Ação</th>
                </tr>
            </thead>
            <tbody>
                {items.map((item) => (
                    <tr key={item.id}>
                        <td className="table-mono">{fmtDate(parseDate(item.data_solicitacao))}</td>
                        <td className="table-mono">{item.cpf_favorecido}</td>
                        <td>
                            <select
                                value={item.tipo_pix_edit ?? item.tipo_pix}
                                onChange={(e) => onUpdateField(item.id, "tipo_pix_edit", e.target.value)}
                                style={{
                                    background: "var(--bg)",
                                    color: "var(--fg)",
                                    border: "1px solid var(--border-light)",
                                    borderRadius: "var(--radius-sm)",
                                    padding: "6px 10px",
                                    fontSize: 13,
                                    cursor: "pointer",
                                }}
                            >
                                {PIX_TYPE_OPTIONS.map((o) => (
                                    <option key={o} value={o}>{o}</option>
                                ))}
                            </select>
                        </td>
                        <td>
                            <input
                                value={item.chave_pix_edit ?? item.chave_pix}
                                onChange={(e) => onUpdateField(item.id, "chave_pix_edit", e.target.value)}
                                style={{
                                    background: "var(--bg)",
                                    color: "var(--fg)",
                                    border: "1px solid var(--border-light)",
                                    borderRadius: "var(--radius-sm)",
                                    padding: "6px 10px",
                                    fontSize: 13,
                                    width: 220,
                                }}
                            />
                        </td>
                        <td style={{ fontWeight: 600, color: "var(--warning)" }}>R$ {item.valor_real.toFixed(2)}</td>
                        <td>
                            <span style={{ fontSize: 12, color: "var(--warning)", maxWidth: 200, display: "block" }}>
                                {item.motivo_bloqueio}
                            </span>
                        </td>
                        <td>
                            <button
                                className="btn btn-ghost"
                                style={{ padding: "6px 12px", fontSize: 12, gap: 6 }}
                                onClick={() => onSave(item.id)}
                            >
                                <Save size={13} /> Salvar
                            </button>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function BloqueadosTable({
    items,
    onForceApprove,
}: {
    items: SaqueItem[];
    onForceApprove: (item: SaqueItem) => void;
}) {
    if (items.length === 0) {
        return <p className="table-empty">Nenhum item bloqueado. ✓</p>;
    }
    return (
        <table className="data-table">
            <thead>
                <tr>
                    <th>Data Solicitação</th>
                    <th>CPF Solicitante</th>
                    <th>CPF Favorecido</th>
                    <th>Chave PIX</th>
                    <th>Valor</th>
                    <th>Motivo do Bloqueio</th>
                    <th>Ação</th>
                </tr>
            </thead>
            <tbody>
                {items.map((item) => (
                    <tr key={item.id}>
                        <td className="table-mono">{fmtDate(parseDate(item.data_solicitacao))}</td>
                        <td className="table-mono">{item.cpf_conta}</td>
                        <td className="table-mono">{item.cpf_favorecido}</td>
                        <td className="table-mono" style={{ fontSize: 13 }}>{item.chave_pix || "—"}</td>
                        <td style={{ fontWeight: 600, color: "var(--danger)" }}>R$ {item.valor_real.toFixed(2)}</td>
                        <td>
                            <span style={{ fontSize: 12, color: "var(--danger)" }}>{item.motivo_bloqueio}</span>
                        </td>
                        <td>
                            <button
                                className="btn"
                                style={{
                                    padding: "6px 12px",
                                    fontSize: 12,
                                    gap: 6,
                                    background: "rgba(248,113,113,0.12)",
                                    color: "var(--danger)",
                                    border: "1px solid rgba(248,113,113,0.3)",
                                }}
                                onClick={() => onForceApprove(item)}
                            >
                                <AlertOctagon size={13} /> Forçar Aprovação
                            </button>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
