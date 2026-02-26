"use client";

/* ================================================================
   MÓDULO DE EMISSÃO DE NOTAS DE CRÉDITO (NC)
   ================================================================
   ⚠️ ESCOPO ISOLADO: Este arquivo é 100% independente.
   - NÃO importa nada de NovoFaturamento.tsx ou seus parsers.
   - NÃO modifica tipagens globais.
   - Toda lógica NC vive neste arquivo ou no seu API route exclusivo.
   ================================================================ */

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
    Upload,
    FileSpreadsheet,
    FileText,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Loader2,
    Download,
    RefreshCw,
    DollarSign,
    Building2,
    ReceiptText,
    SendHorizonal,
    X,
} from "lucide-react";

/* ================================================================
   TIPAGENS EXCLUSIVAS DO MÓDULO NC
   ================================================================ */

export interface NotaCreditoPlanilha {
    loja: string;
    cnpj: string;           // apenas dígitos (normalizarCNPJ_NC)
    estado: string;
    valorBoleto: number;    // "R$ 1.572,30" → 1572.30
    valorNF: number;
    valorNC: number;
    descricaoServico: string; // concatenação de "Nº NF" e "DESCONTO"
}

type EmissaoStatus = "idle" | "parsing" | "ready" | "emitting" | "done" | "error";

interface EmissaoResult {
    loja: string;
    ok: boolean;
    mensagem: string;
}

/* ================================================================
   HELPERS EXCLUSIVOS NC — não alteram helpers do NovoFaturamento
   ================================================================ */

/** Remove qualquer caractere não-dígito do CNPJ */
function normalizarCNPJ_NC(raw: string): string {
    return (raw ?? "").replace(/\D/g, "");
}

/** Formata CNPJ para exibição: XX.XXX.XXX/XXXX-XX */
function formatarCNPJ_NC(digits: string): string {
    if (digits.length !== 14) return digits;
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

/**
 * Converte string monetária para número decimal.
 * Detecta automaticamente o formato:
 *   - Brasileiro: "1.572,30" (ponto = milhar, vírgula = decimal)
 *   - Internacional: "1572.30" ou "1,572.30"
 *   - Número puro: 1572.30
 */
function parseMoedaBR_NC(val: unknown): number {
    if (val == null || val === "") return 0;
    if (typeof val === "number") return val;

    let s = String(val).replace(/R\$\s*/g, "").trim();
    if (!s) return 0;

    const hasComma = s.includes(",");
    const hasDot = s.includes(".");

    if (hasComma && hasDot) {
        // Ambos presentes — quem vem por último é o separador decimal
        const lastComma = s.lastIndexOf(",");
        const lastDot = s.lastIndexOf(".");
        if (lastComma > lastDot) {
            // "1.572,30" → BR (vírgula é decimal)
            s = s.replace(/\./g, "").replace(",", ".");
        } else {
            // "1,572.30" → Internacional (ponto é decimal)
            s = s.replace(/,/g, "");
        }
    } else if (hasComma && !hasDot) {
        // "1572,30" → vírgula é decimal
        s = s.replace(",", ".");
    } else if (hasDot && !hasComma) {
        // "1572.30" ou "1.234.567"
        const parts = s.split(".");
        if (parts.length > 2) {
            // Múltiplos pontos = separadores de milhar BR sem decimal
            s = s.replace(/\./g, "");
        }
        // Ponto único = decimal internacional → manter como está
    }

    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

/** Retorna string limpa de uma célula */
function str_NC(val: unknown): string {
    return String(val ?? "").trim();
}

/** Formata número para moeda BRL */
function fmtBRL_NC(v: number): string {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Localiza a chave de uma coluna no header — busca exata (case-insensitive),
 * depois busca parcial. Aceita múltiplos candidatos.
 */
function findColNC(headers: string[], ...candidates: string[]): string | null {
    const lower = headers.map((h) => h.toLowerCase().trim());
    for (const c of candidates) {
        const idx = lower.indexOf(c.toLowerCase());
        if (idx >= 0) return headers[idx];
    }
    for (const c of candidates) {
        const idx = lower.findIndex((h) => h.includes(c.toLowerCase()));
        if (idx >= 0) return headers[idx];
    }
    return null;
}

/* ================================================================
   PARSER EXCLUSIVO NC
   Mapeamento de colunas:
     loja            ← "LOJA" | "EMPRESA" | "CLIENTE"
     cnpj            ← "CNPJ"
     estado          ← "ESTADO" | "UF"
     valorBoleto     ← "VALOR BOLETO" | "BOLETO"
     valorNF         ← "VALOR NF" | "NF" | "VALOR DA NF"
     valorNC         ← "VALOR NC" | "NC" | "VALOR DA NC"
     descricaoServico← concatenação de "Nº NF" + " - " + "DESCONTO"
   ================================================================ */

function parsearPlanilhaNC(rawRows: Record<string, string>[]): {
    dados: NotaCreditoPlanilha[];
    erros: string[];
} {
    if (rawRows.length === 0) return { dados: [], erros: ["Planilha vazia."] };

    const headers = Object.keys(rawRows[0]);
    const erros: string[] = [];

    const colLoja = findColNC(headers, "loja", "empresa", "cliente", "store");
    const colCnpj = findColNC(headers, "cnpj");
    const colEstado = findColNC(headers, "estado", "uf");
    const colBoleto = findColNC(headers, "valor boleto", "vlr boleto", "boleto", "valor do boleto");
    const colNF = findColNC(headers, "valor nf", "vlr nf", "nf", "valor da nf", "valor nota fiscal");
    const colNC = findColNC(headers, "valor nc", "vlr nc", "nc", "valor da nc", "valor nota crédito", "nota crédito");
    const colNumNF = findColNC(headers, "nº nf", "num nf", "numero nf", "número nf", "nf numero", "nº da nf");
    const colDesconto = findColNC(headers, "desconto", "discount", "número do pedido", "pedido");

    const missing: string[] = [];
    if (!colLoja) missing.push("LOJA");
    if (!colCnpj) missing.push("CNPJ");
    if (!colNC) missing.push("VALOR NC");

    if (missing.length > 0) {
        erros.push(`Colunas obrigatórias não encontradas: ${missing.join(", ")}. Verifique o cabeçalho da planilha.`);
        return { dados: [], erros };
    }

    const dados: NotaCreditoPlanilha[] = [];

    rawRows.forEach((row, idx) => {
        const loja = str_NC(colLoja ? row[colLoja] : "");
        const cnpjRaw = str_NC(colCnpj ? row[colCnpj] : "");
        const estado = str_NC(colEstado ? row[colEstado] : "").toUpperCase();
        const boleto = parseMoedaBR_NC(colBoleto ? row[colBoleto] : "");
        const nf = parseMoedaBR_NC(colNF ? row[colNF] : "");
        const nc = parseMoedaBR_NC(colNC ? row[colNC] : "");
        const numNF = str_NC(colNumNF ? row[colNumNF] : "");
        const desc = str_NC(colDesconto ? row[colDesconto] : "");

        if (!loja) {
            erros.push(`Linha ${idx + 2}: campo LOJA vazio — linha ignorada.`);
            return;
        }

        // Concatenação limpa: "19770 - Número do pedido: 6700100984"
        let descricaoServico = numNF;
        if (desc) {
            descricaoServico = descricaoServico
                ? `${descricaoServico} - ${desc}`
                : desc;
        }

        dados.push({
            loja: loja.toUpperCase(),
            cnpj: normalizarCNPJ_NC(cnpjRaw),
            estado,
            valorBoleto: boleto,
            valorNF: nf,
            valorNC: nc,
            descricaoServico: descricaoServico.trim(),
        });
    });

    return { dados, erros };
}

/* ================================================================
   COMPONENT
   ================================================================ */

export default function EmissaoNotaCredito() {
    /* --- Estado geral --- */
    const [status, setStatus] = useState<EmissaoStatus>("idle");
    const [fileName, setFileName] = useState<string>("");
    const [dados, setDados] = useState<NotaCreditoPlanilha[]>([]);
    const [errosParsing, setErrosParsing] = useState<string[]>([]);
    const [nomePasta, setNomePasta] = useState<string>("");
    const [resultados, setResultados] = useState<EmissaoResult[]>([]);
    const [erroGlobal, setErroGlobal] = useState<string>("");

    /* --- Totalizadores --- */
    const totalNC = dados.reduce((s, d) => s + d.valorNC, 0);
    const totalNF = dados.reduce((s, d) => s + d.valorNF, 0);
    const totalBoleto = dados.reduce((s, d) => s + d.valorBoleto, 0);

    /* ================================================================
       DROPZONE & PARSING
       ================================================================ */

    const parseFile = useCallback((file: File) => {
        setStatus("parsing");
        setErrosParsing([]);
        setDados([]);
        setResultados([]);
        setErroGlobal("");
        setFileName(file.name);

        const ext = file.name.split(".").pop()?.toLowerCase();

        if (ext === "csv") {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                encoding: "UTF-8",
                complete: (result) => {
                    const { dados: parsed, erros } = parsearPlanilhaNC(
                        result.data as Record<string, string>[]
                    );
                    setDados(parsed);
                    setErrosParsing(erros);
                    setStatus(parsed.length > 0 ? "ready" : "error");
                },
                error: (err) => {
                    setErrosParsing([`Erro ao ler CSV: ${err.message}`]);
                    setStatus("error");
                },
            });
        } else if (ext === "xlsx" || ext === "xls") {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const wb = XLSX.read(e.target?.result, { type: "binary" });
                    const ws = wb.Sheets[wb.SheetNames[0]];
                    const raw = XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
                        defval: "",
                        raw: false, // cell values as formatted strings
                    });
                    const { dados: parsed, erros } = parsearPlanilhaNC(raw);
                    setDados(parsed);
                    setErrosParsing(erros);
                    setStatus(parsed.length > 0 ? "ready" : "error");
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : "Erro desconhecido";
                    setErrosParsing([`Erro ao ler XLSX: ${msg}`]);
                    setStatus("error");
                }
            };
            reader.readAsBinaryString(file);
        } else {
            setErrosParsing(["Formato não suportado. Use CSV ou XLSX."]);
            setStatus("error");
        }
    }, []);

    const onDrop = useCallback(
        (accepted: File[]) => {
            if (accepted.length > 0) parseFile(accepted[0]);
        },
        [parseFile]
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            "text/csv": [".csv"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
            "application/vnd.ms-excel": [".xls"],
        },
        multiple: false,
    });

    /* ================================================================
       EMISSÃO → chama API route exclusiva do NC
       ================================================================ */

    const handleEmitir = async () => {
        if (dados.length === 0) return;

        setStatus("emitting");
        setResultados([]);
        setErroGlobal("");

        try {
            const response = await fetch("/api/notas-credito/emitir", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    items: dados,
                    nomePasta: nomePasta.trim() || "Notas_Credito",
                }),
            });

            const json = await response.json();

            if (!response.ok) {
                throw new Error(json.error || `Erro ${response.status}`);
            }

            setResultados(json.resultados || []);
            setStatus("done");
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Erro desconhecido";
            setErroGlobal(msg);
            setStatus("error");
        }
    };

    const handleReset = () => {
        setStatus("idle");
        setFileName("");
        setDados([]);
        setErrosParsing([]);
        setResultados([]);
        setErroGlobal("");
        setNomePasta("");
    };

    /* --- Inline field edit --- */
    const handleFieldChange_NC = (rowIdx: number, field: keyof NotaCreditoPlanilha, rawValue: string) => {
        setDados(prev => prev.map((d, i) => {
            if (i !== rowIdx) return d;
            if (field === "valorBoleto" || field === "valorNF" || field === "valorNC") {
                return { ...d, [field]: parseMoedaBR_NC(rawValue) };
            }
            if (field === "cnpj") {
                return { ...d, cnpj: normalizarCNPJ_NC(rawValue) };
            }
            return { ...d, [field]: rawValue };
        }));
    };

    /* ================================================================
       RENDER
       ================================================================ */

    const isEmitting = status === "emitting";
    const isParsing = status === "parsing";
    const canEmit = status === "ready" && dados.length > 0;
    const isDone = status === "done";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>

            {/* ── CARDS DE TOTALIZADORES ── */}
            {dados.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
                    <SummaryCard
                        label="Lojas"
                        value={String(dados.length)}
                        icon={<Building2 size={20} />}
                        color="var(--accent)"
                    />
                    <SummaryCard
                        label="Total NC"
                        value={fmtBRL_NC(totalNC)}
                        icon={<ReceiptText size={20} />}
                        color="var(--success)"
                    />
                    <SummaryCard
                        label="Total NF"
                        value={fmtBRL_NC(totalNF)}
                        icon={<FileText size={20} />}
                        color="var(--warning)"
                    />
                    <SummaryCard
                        label="Total Boleto"
                        value={fmtBRL_NC(totalBoleto)}
                        icon={<DollarSign size={20} />}
                        color="var(--fg-muted)"
                    />
                </div>
            )}

            {/* ── UPLOAD & CONFIGURAÇÃO ── */}
            <div className="card">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                    <h2 style={{ fontSize: 16, fontWeight: 600, color: "#fff", margin: 0 }}>
                        1. Upload da Planilha
                    </h2>
                    {status !== "idle" && (
                        <button onClick={handleReset} className="btn btn-ghost" style={{ padding: "8px 16px", fontSize: 13 }}>
                            <RefreshCw size={14} />
                            Reiniciar
                        </button>
                    )}
                </div>

                {/* Campo Nome da Pasta */}
                <div className="input-group" style={{ marginBottom: 20 }}>
                    <label className="input-label">Nome da Pasta (GCP)</label>
                    <div className="input-wrapper">
                        <div className="input-icon"><FileSpreadsheet size={16} /></div>
                        <input
                            className="input"
                            type="text"
                            placeholder="Ex: NC_Fevereiro_2026"
                            value={nomePasta}
                            onChange={(e) => setNomePasta(e.target.value)}
                            disabled={isEmitting || isDone}
                        />
                    </div>
                </div>

                {/* Dropzone */}
                <div
                    {...getRootProps()}
                    className={`dropzone ${isDragActive ? "dropzone-active" : ""}`}
                    style={{ opacity: isEmitting || isDone ? 0.6 : 1, cursor: isEmitting || isDone ? "not-allowed" : "pointer" }}
                >
                    <input {...getInputProps()} disabled={isEmitting || isDone} />
                    {isParsing ? (
                        <>
                            <Loader2 size={36} className="dropzone-icon" style={{ animation: "spin 1s linear infinite" }} />
                            <p className="dropzone-text">Processando planilha…</p>
                        </>
                    ) : fileName ? (
                        <>
                            <FileSpreadsheet size={36} style={{ color: "var(--accent)" }} />
                            <span className="dropzone-filename">
                                <Download size={14} />
                                {fileName}
                            </span>
                            {!isDone && <p className="dropzone-text" style={{ fontSize: 12, marginTop: 4 }}>Clique ou arraste para substituir</p>}
                        </>
                    ) : (
                        <>
                            <Upload size={36} className="dropzone-icon" />
                            <p className="dropzone-text">
                                Arraste a planilha NC aqui, ou <strong style={{ color: "var(--accent)" }}>clique para selecionar</strong>
                            </p>
                            <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>CSV ou XLSX • colunas: LOJA, CNPJ, ESTADO, VALOR BOLETO, VALOR NF, VALOR NC, Nº NF, DESCONTO</p>
                        </>
                    )}
                </div>

                {/* Erros de parsing */}
                {errosParsing.length > 0 && (
                    <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                        {errosParsing.map((e, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 14px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8 }}>
                                <AlertTriangle size={16} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }} />
                                <span style={{ fontSize: 13, color: "var(--danger)" }}>{e}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── PREVIEW TABLE ── */}
            {dados.length > 0 && (
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: "1px solid var(--border)" }}>
                        <h2 style={{ fontSize: 16, fontWeight: 600, color: "#fff", margin: 0 }}>
                            2. Preview de Emissão
                            <span className="badge badge-info" style={{ marginLeft: 10, fontSize: 12 }}>
                                {dados.length} {dados.length === 1 ? "loja" : "lojas"}
                            </span>
                        </h2>
                    </div>

                    <div style={{ overflowX: "auto" }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Loja</th>
                                    <th>CNPJ</th>
                                    <th>UF</th>
                                    <th>Descrição Serviço</th>
                                    <th style={{ textAlign: "right" }}>Valor Boleto</th>
                                    <th style={{ textAlign: "right" }}>Valor NF</th>
                                    <th style={{ textAlign: "right" }}>Valor NC</th>
                                    {isDone && <th>Status</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {dados.map((row, idx) => {
                                    const resultado = resultados.find(r => r.loja === row.loja);
                                    const canEdit = !isDone && !isEmitting;
                                    return (
                                        <tr key={idx}>
                                            <td style={{ color: "var(--fg-dim)", fontSize: 12 }}>{idx + 1}</td>
                                            <td>
                                                {canEdit ? (
                                                    <EditableCell_NC value={row.loja} onSave={v => handleFieldChange_NC(idx, "loja", v)} bold />
                                                ) : (
                                                    <span className="table-primary">{row.loja}</span>
                                                )}
                                            </td>
                                            <td>
                                                {canEdit ? (
                                                    <EditableCell_NC value={formatarCNPJ_NC(row.cnpj)} onSave={v => handleFieldChange_NC(idx, "cnpj", v)} mono />
                                                ) : (
                                                    <span className="table-mono">{formatarCNPJ_NC(row.cnpj)}</span>
                                                )}
                                            </td>
                                            <td>
                                                {canEdit ? (
                                                    <EditableCell_NC value={row.estado} onSave={v => handleFieldChange_NC(idx, "estado", v)} />
                                                ) : (
                                                    <span className="badge badge-info" style={{ fontSize: 11 }}>{row.estado || "—"}</span>
                                                )}
                                            </td>
                                            <td style={{ maxWidth: 280 }}>
                                                {canEdit ? (
                                                    <EditableCell_NC value={row.descricaoServico} onSave={v => handleFieldChange_NC(idx, "descricaoServico", v)} maxW={270} />
                                                ) : (
                                                    <span style={{ fontSize: 13, color: "var(--fg-muted)" }}>{row.descricaoServico || "—"}</span>
                                                )}
                                            </td>
                                            <td style={{ textAlign: "right" }}>
                                                {canEdit ? (
                                                    <EditableCell_NC value={fmtBRL_NC(row.valorBoleto)} onSave={v => handleFieldChange_NC(idx, "valorBoleto", v)} align="right" />
                                                ) : (
                                                    <span style={{ fontSize: 13, color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>{fmtBRL_NC(row.valorBoleto)}</span>
                                                )}
                                            </td>
                                            <td style={{ textAlign: "right" }}>
                                                {canEdit ? (
                                                    <EditableCell_NC value={fmtBRL_NC(row.valorNF)} onSave={v => handleFieldChange_NC(idx, "valorNF", v)} align="right" />
                                                ) : (
                                                    <span style={{ fontSize: 13, color: "var(--warning)", fontVariantNumeric: "tabular-nums" }}>{fmtBRL_NC(row.valorNF)}</span>
                                                )}
                                            </td>
                                            <td style={{ textAlign: "right" }}>
                                                {canEdit ? (
                                                    <EditableCell_NC value={fmtBRL_NC(row.valorNC)} onSave={v => handleFieldChange_NC(idx, "valorNC", v)} align="right" bold />
                                                ) : (
                                                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--success)", fontVariantNumeric: "tabular-nums" }}>{fmtBRL_NC(row.valorNC)}</span>
                                                )}
                                            </td>
                                            {isDone && (
                                                <td>
                                                    {resultado ? (
                                                        resultado.ok ? (
                                                            <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--success)", fontSize: 12 }}>
                                                                <CheckCircle2 size={14} /> Enviado
                                                            </span>
                                                        ) : (
                                                            <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--danger)", fontSize: 12 }} title={resultado.mensagem}>
                                                                <XCircle size={14} /> Erro
                                                            </span>
                                                        )
                                                    ) : (
                                                        <span style={{ color: "var(--fg-dim)", fontSize: 12 }}>—</span>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── BOTÃO EMITIR ── */}
            {(canEmit || isEmitting) && (
                <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                    <div>
                        <p style={{ fontWeight: 600, color: "#fff", margin: 0 }}>3. Emitir Notas de Crédito</p>
                        <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: "4px 0 0" }}>
                            Serão disparados <strong style={{ color: "var(--accent)" }}>{dados.length}</strong> registros NC para o GCP (Conta Azul / Prefeitura).
                        </p>
                    </div>
                    <button
                        className="btn btn-primary"
                        onClick={handleEmitir}
                        disabled={isEmitting}
                        style={{ minWidth: 200, padding: "14px 28px", fontSize: 15, flexShrink: 0 }}
                    >
                        {isEmitting ? (
                            <>
                                <Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} />
                                Emitindo…
                            </>
                        ) : (
                            <>
                                <SendHorizonal size={18} />
                                Emitir Notas de Crédito
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* ── RESULTADO GLOBAL ── */}
            {erroGlobal && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 20px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 12 }}>
                    <X size={18} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }} />
                    <div>
                        <p style={{ fontWeight: 600, color: "var(--danger)", margin: 0 }}>Falha no disparo</p>
                        <p style={{ fontSize: 13, color: "var(--danger)", margin: "4px 0 0", opacity: 0.85 }}>{erroGlobal}</p>
                    </div>
                </div>
            )}

            {isDone && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 20px", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 12 }}>
                    <CheckCircle2 size={18} style={{ color: "var(--success)", flexShrink: 0, marginTop: 1 }} />
                    <div>
                        <p style={{ fontWeight: 600, color: "var(--success)", margin: 0 }}>Emissão iniciada com sucesso!</p>
                        <p style={{ fontSize: 13, color: "var(--success)", margin: "4px 0 0", opacity: 0.85 }}>
                            {resultados.filter(r => r.ok).length} de {resultados.length} registros enviados ao GCP.
                            As Notas de Crédito serão geradas em breve.
                        </p>
                    </div>
                </div>
            )}

            {/* CSS inline para animação de spin */}
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}

/* ================================================================
   SUB-COMPONENTE: Célula editável inline
   ================================================================ */

function EditableCell_NC({ value, onSave, mono, bold, align, maxW }: {
    value: string; onSave: (v: string) => void;
    mono?: boolean; bold?: boolean; align?: string; maxW?: number;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);

    const commit = () => {
        setEditing(false);
        if (draft !== value) onSave(draft);
    };

    if (editing) {
        return (
            <input autoFocus type="text" value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
                style={{
                    background: "rgba(129,140,248,0.08)", border: "1px solid var(--accent)", borderRadius: 4,
                    padding: "3px 6px", fontSize: 12, color: "#fff", width: "100%", maxWidth: maxW,
                    textAlign: (align as any) || "left", fontFamily: mono ? "monospace" : "inherit",
                    fontWeight: bold ? 600 : 400, outline: "none",
                }}
            />
        );
    }

    return (
        <span onClick={() => { setDraft(value); setEditing(true); }}
            title="Clique para editar"
            style={{
                cursor: "pointer", fontSize: 13, padding: "2px 4px", borderRadius: 4,
                display: "inline-block", maxWidth: maxW, overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap", textAlign: (align as any) || "left",
                fontFamily: mono ? "monospace" : "inherit",
                fontWeight: bold ? 600 : 400,
                color: value ? (bold ? "#fff" : "var(--fg-muted)") : "var(--fg-dim)",
                borderBottom: "1px dashed var(--border)",
                fontVariantNumeric: "tabular-nums",
            }}>
            {value || "—"}
        </span>
    );
}

/* ================================================================
   SUB-COMPONENTE: Card de resumo
   ================================================================ */

function SummaryCard({
    label,
    value,
    icon,
    color,
}: {
    label: string;
    value: string;
    icon: React.ReactNode;
    color: string;
}) {
    return (
        <div
            className="card"
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: "18px 20px",
                borderLeft: `3px solid ${color}`,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 8, color }}>
                {icon}
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {label}
                </span>
            </div>
            <span style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px" }}>
                {value}
            </span>
        </div>
    );
}
