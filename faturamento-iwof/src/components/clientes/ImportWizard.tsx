"use client";

import { useState, useEffect, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
    Upload,
    FileSpreadsheet,
    Download,
    Save,
    AlertCircle,
    CheckCircle2,
    ArrowLeft,
    ArrowRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/* ================================================================
   TYPES
   ================================================================ */

interface Ciclo {
    id: string;
    nome: string;
}

interface ImportRow {
    /* Identification */
    nome: string;
    razao_social: string;
    nome_fantasia: string;
    cnpj: string;
    cpf: string;
    id_estrangeiro: string;
    data_criacao: string;
    observacoes: string;
    status: boolean;
    codigo: string;
    inscricao_estadual: string;
    /* Contact */
    email_principal: string;
    telefone_principal: string;
    data_fundacao: string;
    /* Address */
    cep: string;
    estado: string;
    cidade: string;
    endereco: string;
    numero: string;
    bairro: string;
    complemento: string;
    /* Operational (may need completion) */
    nome_contato: string;
    email_contato: string;
    nome_conta_azul: string;
    tempo_pagamento_dias: number | "";
    boleto_unificado: boolean;
    ciclo_faturamento_id: string;
    /* Internal */
    _needsCompletion: boolean;
}

type Step = "upload" | "completion";

/* ================================================================
   COLUMN MAP — spreadsheet header → field key
   ================================================================ */

const COLUMN_MAP: Record<string, keyof ImportRow> = {
    nome: "nome",
    "razão social": "razao_social",
    "razao social": "razao_social",
    razao_social: "razao_social",
    "nome fantasia": "nome_fantasia",
    nome_fantasia: "nome_fantasia",
    cnpj: "cnpj",
    cpf: "cpf",
    "id estrangeiro": "id_estrangeiro",
    id_estrangeiro: "id_estrangeiro",
    datacriacao: "data_criacao",
    data_criacao: "data_criacao",
    "observações": "observacoes",
    observacoes: "observacoes",
    status: "status",
    "código": "codigo",
    codigo: "codigo",
    "inscrição estadual": "inscricao_estadual",
    "inscricao estadual": "inscricao_estadual",
    inscricao_estadual: "inscricao_estadual",
    "email principal": "email_principal",
    email_principal: "email_principal",
    "telefone principal": "telefone_principal",
    telefone_principal: "telefone_principal",
    "data fundação/aniversário": "data_fundacao",
    "data fundacao/aniversario": "data_fundacao",
    data_fundacao: "data_fundacao",
    cep: "cep",
    estado: "estado",
    cidade: "cidade",
    "endereço": "endereco",
    endereco: "endereco",
    "número": "numero",
    numero: "numero",
    bairro: "bairro",
    complemento: "complemento",
    "nome contato": "nome_contato",
    nome_contato: "nome_contato",
    "e-mail contato": "email_contato",
    "email contato": "email_contato",
    email_contato: "email_contato",
    "nome conta azul": "nome_conta_azul",
    nome_conta_azul: "nome_conta_azul",
    "tempo para pagamento (em dias)": "tempo_pagamento_dias",
    tempo_pagamento_dias: "tempo_pagamento_dias",
    "boleto unificado (true or false)": "boleto_unificado",
    "boleto unificado": "boleto_unificado",
    boleto_unificado: "boleto_unificado",
    ciclo: "ciclo_faturamento_id",
    ciclo_faturamento: "ciclo_faturamento_id",
};

/* Operational fields that require completion */
const OPERATIONAL_FIELDS: (keyof ImportRow)[] = [
    "nome_conta_azul",
    "email_contato",
    "tempo_pagamento_dias",
    "boleto_unificado",
    "ciclo_faturamento_id",
];

/* Template headers for download */
const TEMPLATE_HEADERS = [
    "Nome",
    "Razão Social",
    "CNPJ",
    "CPF",
    "ID Estrangeiro",
    "DataCriacao",
    "Observações",
    "Status",
    "Código",
    "Inscrição Estadual",
    "Email principal",
    "Telefone principal",
    "Data fundação/Aniversário",
    "CEP",
    "Estado",
    "Cidade",
    "Endereço",
    "Número",
    "Bairro",
    "Complemento",
    "Nome Contato",
    "E-mail Contato",
    "NOME CONTA AZUL",
    "Tempo para pagamento (em dias)",
    "Boleto unificado (true or false)",
    "Ciclo",
];

/* ================================================================
   COMPONENT
   ================================================================ */

export default function ImportWizard() {
    const supabase = createClient();

    const [ciclos, setCiclos] = useState<Ciclo[]>([]);
    const [allRows, setAllRows] = useState<ImportRow[]>([]);
    const [fileName, setFileName] = useState("");
    const [step, setStep] = useState<Step>("upload");
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<{ ok: number; err: number } | null>(null);

    /* Fetch ciclos */
    useEffect(() => {
        supabase
            .from("ciclos_faturamento")
            .select("id, nome")
            .order("nome")
            .then(({ data }) => {
                if (data) setCiclos(data);
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ---- resolve ciclo name → id ---- */
    const resolveCicloId = useCallback(
        (raw: string): string => {
            if (!raw) return "";
            const match = ciclos.find(
                (c) => c.nome.toLowerCase() === raw.trim().toLowerCase()
            );
            return match?.id ?? "";
        },
        [ciclos]
    );

    /* ---- check if row needs operational completion ---- */
    const checkNeedsCompletion = (r: ImportRow): boolean => {
        return (
            !r.nome_conta_azul?.trim() ||
            !r.email_contato?.trim() ||
            r.tempo_pagamento_dias === "" ||
            r.tempo_pagamento_dias === 0 ||
            !r.ciclo_faturamento_id
        );
    };

    /* ---- map raw object to ImportRow ---- */
    const mapRow = useCallback(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (raw: Record<string, any>): ImportRow => {
            const row: ImportRow = {
                nome: "",
                razao_social: "",
                nome_fantasia: "",
                cnpj: "",
                cpf: "",
                id_estrangeiro: "",
                data_criacao: "",
                observacoes: "",
                status: true,
                codigo: "",
                inscricao_estadual: "",
                email_principal: "",
                telefone_principal: "",
                data_fundacao: "",
                cep: "",
                estado: "",
                cidade: "",
                endereco: "",
                numero: "",
                bairro: "",
                complemento: "",
                nome_contato: "",
                email_contato: "",
                nome_conta_azul: "",
                tempo_pagamento_dias: "",
                boleto_unificado: false,
                ciclo_faturamento_id: "",
                _needsCompletion: false,
            };

            for (const [header, value] of Object.entries(raw)) {
                const key = COLUMN_MAP[header.toLowerCase().trim()];
                if (!key || key === "_needsCompletion") continue;

                if (key === "tempo_pagamento_dias") {
                    const n = parseInt(String(value));
                    row.tempo_pagamento_dias = isNaN(n) ? "" : n;
                } else if (key === "status") {
                    const s = String(value).toLowerCase().trim();
                    row.status = !(s === "false" || s === "0" || s === "inativo");
                } else if (key === "boleto_unificado") {
                    const s = String(value).toLowerCase().trim();
                    row.boleto_unificado = s === "true" || s === "1" || s === "sim";
                } else if (key === "ciclo_faturamento_id") {
                    row.ciclo_faturamento_id = resolveCicloId(String(value));
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (row as any)[key] = String(value ?? "").trim();
                }
            }

            row._needsCompletion = checkNeedsCompletion(row);
            return row;
        },
        [resolveCicloId]
    );

    /* ---- file processing ---- */
    const processData = useCallback(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (rawRows: Record<string, any>[]) => {
            const mapped = rawRows
                .filter((r) =>
                    Object.values(r).some(
                        (v) => v !== null && v !== undefined && String(v).trim() !== ""
                    )
                )
                .map(mapRow);
            setAllRows(mapped);
            setResult(null);

            const hasIncomplete = mapped.some((r) => r._needsCompletion);
            setStep(hasIncomplete ? "completion" : "completion");
        },
        [mapRow]
    );

    const onDrop = useCallback(
        (acceptedFiles: File[]) => {
            const file = acceptedFiles[0];
            if (!file) return;
            setFileName(file.name);
            setResult(null);

            const ext = file.name.split(".").pop()?.toLowerCase();

            if (ext === "xlsx" || ext === "xls") {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const data = new Uint8Array(e.target?.result as ArrayBuffer);
                    const wb = XLSX.read(data, { type: "array" });
                    const sheet = wb.Sheets[wb.SheetNames[0]];
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const json = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
                    processData(json);
                };
                reader.readAsArrayBuffer(file);
            } else {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const csv = e.target?.result as string;
                    Papa.parse(csv, {
                        header: true,
                        skipEmptyLines: true,
                        complete: (results) => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            processData(results.data as Record<string, any>[]);
                        },
                    });
                };
                reader.readAsText(file, "ISO-8859-1");
            }
        },
        [processData]
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            "text/csv": [".csv"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
            "application/vnd.ms-excel": [".xls"],
        },
        maxFiles: 1,
    });

    /* ---- download template ---- */
    const downloadTemplate = () => {
        const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
        /* Set column widths */
        ws["!cols"] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(h.length + 4, 18) }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Clientes");
        XLSX.writeFile(wb, "modelo_clientes.xlsx");
    };

    /* ---- update a single row field ---- */
    const updateRow = (
        idx: number,
        field: keyof ImportRow,
        value: string | number | boolean
    ) => {
        setAllRows((prev) => {
            const copy = [...prev];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (copy[idx] as any)[field] = value;
            copy[idx]._needsCompletion = checkNeedsCompletion(copy[idx]);
            return copy;
        });
    };

    /* ---- Derived data ---- */
    const incompleteRows = allRows
        .map((r, i) => ({ row: r, originalIndex: i }))
        .filter((item) => item.row._needsCompletion);
    const allComplete = allRows.length > 0 && incompleteRows.length === 0;
    const totalRows = allRows.length;

    /* ---- upsert ---- */
    const handleSave = async () => {
        setSaving(true);
        let ok = 0;
        let err = 0;

        for (const row of allRows) {
            const payload = {
                nome: row.nome || null,
                razao_social: row.razao_social,
                cnpj: row.cnpj,
                cpf: row.cpf || null,
                id_estrangeiro: row.id_estrangeiro || null,
                data_criacao: row.data_criacao || null,
                observacoes: row.observacoes || null,
                status: row.status,
                codigo: row.codigo || null,
                inscricao_estadual: row.inscricao_estadual || null,
                email_principal: row.email_principal || null,
                telefone_principal: row.telefone_principal || null,
                data_fundacao: row.data_fundacao || null,
                cep: row.cep || null,
                estado: row.estado || null,
                cidade: row.cidade || null,
                endereco: row.endereco || null,
                numero: row.numero || null,
                bairro: row.bairro || null,
                complemento: row.complemento || null,
                nome_contato: row.nome_contato || null,
                email_contato: row.email_contato || null,
                nome_conta_azul: row.nome_conta_azul || null,
                tempo_pagamento_dias:
                    row.tempo_pagamento_dias === "" ? 30 : row.tempo_pagamento_dias,
                boleto_unificado: row.boleto_unificado,
                ciclo_faturamento_id: row.ciclo_faturamento_id || null,
            };

            const { error } = await supabase
                .from("clientes")
                .upsert(payload, { onConflict: "cnpj" });

            if (error) err++;
            else ok++;
        }

        setResult({ ok, err });
        setSaving(false);
    };

    /* ---- reset ---- */
    const handleReset = () => {
        setAllRows([]);
        setFileName("");
        setResult(null);
        setStep("upload");
    };

    /* ================================================================
       RENDER
       ================================================================ */

    /* --- STEP: UPLOAD --- */
    if (step === "upload") {
        return (
            <div>
                <div className="import-top">
                    <div
                        {...getRootProps()}
                        className={`dropzone ${isDragActive ? "dropzone-active" : ""}`}
                    >
                        <input {...getInputProps()} />
                        <Upload size={32} className="dropzone-icon" />
                        <p className="dropzone-text">
                            {isDragActive
                                ? "Solte o ficheiro aqui..."
                                : "Arraste um ficheiro .csv ou .xlsx ou clique para selecionar"}
                        </p>
                        {fileName && (
                            <span className="dropzone-filename">
                                <FileSpreadsheet size={14} /> {fileName}
                            </span>
                        )}
                    </div>

                    <button className="btn btn-ghost" onClick={downloadTemplate}>
                        <Download size={18} />
                        Baixar Modelo XLSX
                    </button>
                </div>

                {result && (
                    <div
                        className={`import-result ${result.err > 0 ? "import-result-warn" : "import-result-ok"}`}
                    >
                        <CheckCircle2 size={18} />
                        <span>
                            {result.ok} registro(s) salvos com sucesso.
                            {result.err > 0 && ` ${result.err} erro(s).`}
                        </span>
                    </div>
                )}
            </div>
        );
    }

    /* --- STEP: COMPLETION --- */
    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
                <div>
                    <button
                        className="btn btn-ghost mb-3"
                        onClick={handleReset}
                    >
                        <ArrowLeft size={16} />
                        Voltar ao Upload
                    </button>
                    <h3 className="text-lg font-semibold text-white">
                        Revisão dos Dados Importados
                    </h3>
                    <p className="text-sm text-[var(--fg-muted)] mt-1">
                        <span className="font-medium text-white">{totalRows}</span> registros
                        lidos de{" "}
                        <span className="text-[var(--accent)]">{fileName}</span>
                        {incompleteRows.length > 0 && (
                            <>
                                {" "}
                                ·{" "}
                                <span className="text-[var(--warning)] font-medium">
                                    {incompleteRows.length} pendente(s)
                                </span>
                            </>
                        )}
                    </p>
                </div>
            </div>

            {/* Result banner */}
            {result && (
                <div
                    className={`import-result ${result.err > 0 ? "import-result-warn" : "import-result-ok"}`}
                >
                    <CheckCircle2 size={18} />
                    <span>
                        {result.ok} registro(s) salvos com sucesso.
                        {result.err > 0 && ` ${result.err} erro(s).`}
                    </span>
                </div>
            )}

            {/* Incomplete rows section */}
            {incompleteRows.length > 0 && (
                <div className="card mb-5 p-0 overflow-hidden">
                    <div className="px-4 pt-4 pb-2 flex items-center gap-2">
                        <AlertCircle size={16} className="text-[var(--warning)]" />
                        <h4 className="text-sm font-semibold text-[var(--warning)]">
                            Dados Operacionais Pendentes ({incompleteRows.length})
                        </h4>
                    </div>
                    <p className="px-4 pb-3 text-xs text-[var(--fg-dim)]">
                        Preencha os campos abaixo para completar a importação.
                    </p>

                    <div className="overflow-x-auto">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Cliente</th>
                                    <th>NOME CONTA AZUL</th>
                                    <th>E-mail Contato</th>
                                    <th>Tempo Pgto (dias)</th>
                                    <th>Boleto Unificado</th>
                                    <th>Ciclo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {incompleteRows.map(({ row, originalIndex }) => (
                                    <tr key={originalIndex} className="row-invalid">
                                        <td>
                                            <span className="table-primary">
                                                {row.nome || row.razao_social || row.nome_fantasia}
                                            </span>
                                            <span className="table-secondary">
                                                {row.cnpj}
                                            </span>
                                        </td>
                                        <td>
                                            <input
                                                className="input input-inline w-full"
                                                placeholder="Nome Conta Azul"
                                                value={row.nome_conta_azul}
                                                onChange={(e) =>
                                                    updateRow(
                                                        originalIndex,
                                                        "nome_conta_azul",
                                                        e.target.value
                                                    )
                                                }
                                            />
                                        </td>
                                        <td>
                                            <input
                                                className="input input-inline w-full"
                                                placeholder="email1@ex.com; email2@ex.com"
                                                value={row.email_contato}
                                                onChange={(e) =>
                                                    updateRow(
                                                        originalIndex,
                                                        "email_contato",
                                                        e.target.value
                                                    )
                                                }
                                            />
                                        </td>
                                        <td>
                                            <input
                                                className="input input-inline"
                                                type="number"
                                                min={0}
                                                style={{ width: 90 }}
                                                placeholder="30"
                                                value={row.tempo_pagamento_dias}
                                                onChange={(e) =>
                                                    updateRow(
                                                        originalIndex,
                                                        "tempo_pagamento_dias",
                                                        e.target.value
                                                            ? parseInt(e.target.value)
                                                            : ""
                                                    )
                                                }
                                            />
                                        </td>
                                        <td>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="w-4 h-4 rounded border-[var(--border)] accent-[var(--accent)]"
                                                    checked={row.boleto_unificado}
                                                    onChange={(e) =>
                                                        updateRow(
                                                            originalIndex,
                                                            "boleto_unificado",
                                                            e.target.checked
                                                        )
                                                    }
                                                />
                                                <span className="text-xs text-[var(--fg-muted)]">
                                                    {row.boleto_unificado ? "Sim" : "Não"}
                                                </span>
                                            </label>
                                        </td>
                                        <td>
                                            <select
                                                className="input input-inline"
                                                value={row.ciclo_faturamento_id}
                                                onChange={(e) =>
                                                    updateRow(
                                                        originalIndex,
                                                        "ciclo_faturamento_id",
                                                        e.target.value
                                                    )
                                                }
                                            >
                                                <option value="">Selecione...</option>
                                                {ciclos.map((c) => (
                                                    <option key={c.id} value={c.id}>
                                                        {c.nome}
                                                    </option>
                                                ))}
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Summary table of ALL rows */}
            <div className="card p-0 overflow-hidden">
                <div className="px-4 pt-4 pb-2">
                    <h4 className="text-sm font-semibold text-[var(--fg)]">
                        Todos os Registros ({totalRows})
                    </h4>
                </div>

                <div className="overflow-x-auto">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Nome / Razão Social</th>
                                <th>CNPJ</th>
                                <th>Cidade / Estado</th>
                                <th>Conta Azul</th>
                                <th>Ciclo</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {allRows.map((row, idx) => {
                                const cicloNome = ciclos.find(
                                    (c) => c.id === row.ciclo_faturamento_id
                                )?.nome;
                                return (
                                    <tr
                                        key={idx}
                                        className={row._needsCompletion ? "row-invalid" : ""}
                                    >
                                        <td>
                                            <span className="table-primary">
                                                {row.nome || row.razao_social}
                                            </span>
                                            {row.nome_fantasia && (
                                                <span className="table-secondary">
                                                    {row.nome_fantasia}
                                                </span>
                                            )}
                                        </td>
                                        <td className="table-mono">{row.cnpj}</td>
                                        <td>
                                            <span className="text-sm text-[var(--fg-muted)]">
                                                {[row.cidade, row.estado]
                                                    .filter(Boolean)
                                                    .join(" / ") || "—"}
                                            </span>
                                        </td>
                                        <td>
                                            <span className="text-sm text-[var(--fg-muted)]">
                                                {row.nome_conta_azul || (
                                                    <span className="text-[var(--warning)]">
                                                        Pendente
                                                    </span>
                                                )}
                                            </span>
                                        </td>
                                        <td>
                                            <span className="badge badge-info">
                                                {cicloNome ?? (
                                                    <span className="text-[var(--warning)]">
                                                        —
                                                    </span>
                                                )}
                                            </span>
                                        </td>
                                        <td>
                                            <span
                                                className={`badge ${row.status ? "badge-success" : "badge-danger"}`}
                                            >
                                                {row.status ? "Ativo" : "Inativo"}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between mt-5 pt-4 border-t border-[var(--border)]">
                <button className="btn btn-ghost" onClick={handleReset}>
                    Cancelar
                </button>
                <button
                    className="btn btn-primary"
                    disabled={!allComplete || saving}
                    onClick={handleSave}
                >
                    {saving ? (
                        "Salvando..."
                    ) : (
                        <>
                            <Save size={18} />
                            Guardar na Base de Dados
                            <ArrowRight size={16} />
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
