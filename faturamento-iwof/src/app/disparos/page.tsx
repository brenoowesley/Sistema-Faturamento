"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  MessageSquare,
  Upload,
  Search,
  Send,
  Pause,
  Play,
  X,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  FileSpreadsheet,
  Eye,
  Clock,
  Zap,
  Users,
  Filter,
  Plus,
  Trash2,
  Save,
  RefreshCw,
  Phone,
  Building,
  Hash,
  ArrowRight,
  SkipForward,
} from "lucide-react";
import * as xlsx from "xlsx";
import {
  processarContatos,
  buscarContatosDoBanco,
  buscarLotes,
  type ContatoInput,
  type ContatoProcessado,
} from "./actions";

/* ================================================================
   TYPES
   ================================================================ */

interface Lote {
  id: string;
  nome_pasta: string;
  data_competencia: string;
  data_inicio_ciclo: string;
  data_fim_ciclo: string;
  status: string;
}

interface Template {
  id: string;
  nome: string;
  conteudo: string;
  categoria: string;
}

interface LogEntry {
  type: string;
  message: string;
  timestamp: string;
}

/* ================================================================
   UTILS
   ================================================================ */

const VARIAVEIS = [
  { label: "Nome Fantasia", tag: "{{nome_fantasia}}" },
  { label: "Razão Social", tag: "{{razao_social}}" },
  { label: "Primeiro Nome", tag: "{{primeiro_nome}}" },
  { label: "Valor Total", tag: "{{valor_total}}" },
  { label: "Vencimento", tag: "{{vencimento}}" },
  { label: "Nome do Lote", tag: "{{nome_lote}}" },
];

const fmtDate = (d: string) => {
  if (!d) return "—";
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("pt-BR");
};

const fmtCNPJ = (raw: string) => {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 14) return raw;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

/* ================================================================
   PAGE COMPONENT
   ================================================================ */

export default function CentralDisparosPage() {
  const supabase = createClient();

  // ── AUTH / ROLE ──
  const [cargo, setCargo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ── SEÇÃO 1: Painel de Seleção ──
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [selectedLoteId, setSelectedLoteId] = useState<string | null>(null);
  const [xlsxContatos, setXlsxContatos] = useState<ContatoInput[]>([]);
  const [xlsxFileName, setXlsxFileName] = useState("");
  const [buscaContato, setBuscaContato] = useState("");
  const [contatosBuscados, setContatosBuscados] = useState<ContatoInput[]>([]);
  const [contatosSelecionados, setContatosSelecionados] = useState<ContatoInput[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // ── SEÇÃO 2: Estúdio de Mensagem ──
  const [mensagem, setMensagem] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── SEÇÃO 3: Review de Envio ──
  const [destinatarios, setDestinatarios] = useState<ContatoProcessado[]>([]);
  const [ignorados, setIgnorados] = useState<ContatoProcessado[]>([]);
  const [nomeLote, setNomeLote] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [totalEnvio, setTotalEnvio] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [enviadosCount, setEnviadosCount] = useState(0);
  const [errosCount, setErrosCount] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // ── INIT ──
  useEffect(() => {
    async function init() {
      // Verificar role
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from("usuarios_perfis")
          .select("cargo")
          .eq("id", user.id)
          .single();
        setCargo(data?.cargo || "USER");
      }

      // Carregar lotes
      try {
        const lotesData = await buscarLotes();
        setLotes(lotesData as Lote[]);
      } catch (err) {
        console.error("Erro ao carregar lotes:", err);
      }

      // Carregar templates
      try {
        const res = await fetch("/api/whatsapp/templates");
        const json = await res.json();
        setTemplates(json.templates || []);
      } catch (err) {
        console.error("Erro ao carregar templates:", err);
      }

      setLoading(false);
    }
    init();
  }, [supabase]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ── PERMISSÃO ──
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--accent)]" />
      </div>
    );
  }

  if (cargo !== "ADMIN" && cargo !== "APROVADOR") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card text-center p-12 max-w-md">
          <AlertTriangle className="mx-auto mb-4 text-[var(--warning)]" size={48} />
          <h2 className="text-xl font-bold mb-2">Acesso Restrito</h2>
          <p className="text-[var(--fg-muted)]">
            Apenas usuários com cargo ADMIN ou APROVADOR podem acessar a Central de Disparos.
          </p>
        </div>
      </div>
    );
  }

  // ── HANDLERS ──

  const handleXlsxUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setXlsxFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = evt.target?.result;
      const workbook = xlsx.read(data, { type: "binary" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = xlsx.utils.sheet_to_json<Record<string, string>>(sheet);

      const contatos: ContatoInput[] = json
        .map((row) => {
          // Tenta encontrar colunas CNPJ e Telefone (case insensitive)
          const cnpjKey = Object.keys(row).find((k) =>
            k.toLowerCase().includes("cnpj")
          );
          const telKey = Object.keys(row).find(
            (k) =>
              k.toLowerCase().includes("telefone") ||
              k.toLowerCase().includes("fone") ||
              k.toLowerCase().includes("whatsapp") ||
              k.toLowerCase().includes("celular")
          );

          return {
            cnpj: cnpjKey ? String(row[cnpjKey]).trim() : "",
            telefone: telKey ? String(row[telKey]).trim() : "",
          };
        })
        .filter((c) => c.cnpj);

      setXlsxContatos(contatos);
      setContatosSelecionados(contatos);
    };
    reader.readAsBinaryString(file);
  };

  const handleBuscaContato = async () => {
    if (!buscaContato.trim()) return;
    setIsSearching(true);
    try {
      const results = await buscarContatosDoBanco(buscaContato);
      setContatosBuscados(results);
    } catch (err) {
      console.error("Erro na busca:", err);
    }
    setIsSearching(false);
  };

  const handleAdicionarContato = (contato: ContatoInput) => {
    const jaExiste = contatosSelecionados.some(
      (c) => c.cnpj.replace(/\D/g, "") === contato.cnpj.replace(/\D/g, "")
    );
    if (!jaExiste) {
      setContatosSelecionados((prev) => [...prev, contato]);
    }
  };

  const handleRemoverContato = (cnpj: string) => {
    setContatosSelecionados((prev) =>
      prev.filter((c) => c.cnpj.replace(/\D/g, "") !== cnpj.replace(/\D/g, ""))
    );
  };

  const handleProcessarContatos = async () => {
    if (contatosSelecionados.length === 0) {
      alert("Adicione contatos via XLSX ou busca antes de processar.");
      return;
    }

    setIsProcessing(true);
    try {
      const result = await processarContatos(contatosSelecionados, selectedLoteId);
      setDestinatarios(result.destinatarios);
      setIgnorados(result.ignorados);
      setNomeLote(result.nomeLote);
    } catch (err: any) {
      console.error("Erro ao processar:", err);
      alert(`Erro: ${err.message}`);
    }
    setIsProcessing(false);
  };

  const handleTemplateSelect = (templateId: string) => {
    const t = templates.find((t) => t.id === templateId);
    if (t) {
      setMensagem(t.conteudo);
      setSelectedTemplateId(templateId);
    }
  };

  const insertVariable = (tag: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = mensagem.slice(0, start);
    const after = mensagem.slice(end);

    setMensagem(before + tag + after);

    // Reposicionar cursor
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 0);
  };

  // ── LIVE PREVIEW ──
  const previewMessage = useMemo(() => {
    if (!mensagem) return "Sua mensagem aparecerá aqui...";

    const sample = destinatarios[0];
    return mensagem
      .replace(/\{\{nome_fantasia\}\}/gi, sample?.nomeFantasia || "Loja Exemplo")
      .replace(/\{\{razao_social\}\}/gi, sample?.razaoSocial || "Empresa LTDA")
      .replace(/\{\{primeiro_nome\}\}/gi, sample?.primeiroNome || "João")
      .replace(
        /\{\{valor_total\}\}/gi,
        sample?.valorTotal
          ? new Intl.NumberFormat("pt-BR", {
              minimumFractionDigits: 2,
            }).format(sample.valorTotal)
          : "1.250,00"
      )
      .replace(/\{\{vencimento\}\}/gi, sample?.vencimento || "15/04/2026")
      .replace(/\{\{nome_lote\}\}/gi, nomeLote || "Lote Mensal");
  }, [mensagem, destinatarios, nomeLote]);

  // ── DISPARO ──
  const handleIniciarDisparo = async () => {
    if (!mensagem.trim()) {
      alert("Escreva a mensagem antes de disparar.");
      return;
    }
    if (destinatarios.length === 0) {
      alert("Nenhum destinatário para enviar.");
      return;
    }
    if (
      !confirm(
        `Confirmar envio de ${destinatarios.length} mensagens via WhatsApp?`
      )
    )
      return;

    setIsSending(true);
    setIsPaused(false);
    setProgresso(0);
    setTotalEnvio(destinatarios.length);
    setEnviadosCount(0);
    setErrosCount(0);
    setLogs([]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/whatsapp/disparar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinatarios,
          mensagem,
          loteId: selectedLoteId,
          nomeLote,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro no servidor");
      }

      // Ler stream SSE
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.replace(/^data:\s*/, "").trim();
            if (!trimmed) continue;

            try {
              const event = JSON.parse(trimmed);

              setLogs((prev) => [
                ...prev,
                {
                  type: event.type,
                  message: event.message,
                  timestamp: new Date().toLocaleTimeString("pt-BR"),
                },
              ]);

              if (event.type === "SENT" || event.type === "ERROR" || event.type === "SKIP") {
                setProgresso(event.index);
              }
              if (event.enviados !== undefined) setEnviadosCount(event.enviados);
              if (event.erros !== undefined) setErrosCount(event.erros);

              if (event.type === "COMPLETE") {
                setIsSending(false);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Erro no disparo:", err);
        setLogs((prev) => [
          ...prev,
          {
            type: "FATAL",
            message: `❌ Erro fatal: ${err.message}`,
            timestamp: new Date().toLocaleTimeString("pt-BR"),
          },
        ]);
      }
    }

    setIsSending(false);
  };

  const handleCancelarDisparo = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsSending(false);
    setLogs((prev) => [
      ...prev,
      {
        type: "CANCEL",
        message: "🛑 Envio cancelado pelo operador.",
        timestamp: new Date().toLocaleTimeString("pt-BR"),
      },
    ]);
  };

  // ── RENDER ──
  const progressPercent = totalEnvio > 0 ? (progresso / totalEnvio) * 100 : 0;

  return (
    <div className="min-h-screen pb-32">
      {/* ========= HEADER ========= */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <div className="disparo-header-icon">
            <MessageSquare size={24} />
          </div>
          <div>
            <h1 className="page-title flex items-center gap-2">
              Central de Disparos
              <span className="disparo-badge-whatsapp">WhatsApp</span>
            </h1>
            <p className="page-description">
              Envio em massa de notificações de faturamento via Evolution API
            </p>
          </div>
        </div>
      </div>

      <div className="disparo-grid">
        {/* ═══════════════════════════════════════════════════════════ */}
        {/* COLUNA ESQUERDA: Seleção + Estúdio                        */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div className="disparo-col-left">
          {/* ── SEÇÃO 1: Painel de Seleção ── */}
          <section className="card disparo-section">
            <div className="disparo-section-header">
              <div className="disparo-section-icon disparo-section-icon-blue">
                <Users size={18} />
              </div>
              <h2 className="disparo-section-title">Painel de Seleção</h2>
              <span className="disparo-count-badge">
                {contatosSelecionados.length} contatos
              </span>
            </div>

            {/* Lote Selector */}
            <div className="disparo-field">
              <label className="disparo-label">
                <Filter size={14} />
                Lote de Faturamento (opcional)
              </label>
              <div className="disparo-select-wrapper">
                <select
                  className="input disparo-select"
                  value={selectedLoteId || ""}
                  onChange={(e) => setSelectedLoteId(e.target.value || null)}
                >
                  <option value="">Sem filtro de lote</option>
                  {lotes.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome_pasta || `Lote ${l.id.slice(0, 8)}`} — {fmtDate(l.data_competencia)} [{l.status}]
                    </option>
                  ))}
                </select>
                <ChevronDown className="disparo-select-chevron" size={16} />
              </div>
            </div>

            {/* XLSX Upload */}
            <div className="disparo-field">
              <label className="disparo-label">
                <FileSpreadsheet size={14} />
                Upload de Planilha (.xlsx)
              </label>
              <label className="disparo-upload-zone">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleXlsxUpload}
                  className="hidden"
                />
                {xlsxFileName ? (
                  <div className="disparo-upload-result">
                    <CheckCircle2 size={18} className="text-[var(--success)]" />
                    <div>
                      <span className="font-medium">{xlsxFileName}</span>
                      <span className="text-[var(--fg-dim)] text-xs block">
                        {xlsxContatos.length} contatos carregados
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="disparo-upload-placeholder">
                    <Upload size={20} className="text-[var(--fg-dim)]" />
                    <span className="text-sm text-[var(--fg-muted)]">
                      Arraste um XLSX ou clique para selecionar
                    </span>
                    <span className="text-xs text-[var(--fg-dim)]">
                      Colunas esperadas: CNPJ, Telefone
                    </span>
                  </div>
                )}
              </label>
            </div>

            {/* Busca na Base */}
            <div className="disparo-field">
              <label className="disparo-label">
                <Search size={14} />
                Buscar na base de contatos
              </label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    className="input pl-4 w-full"
                    placeholder="Razão social, nome fantasia ou CNPJ..."
                    value={buscaContato}
                    onChange={(e) => setBuscaContato(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleBuscaContato()}
                  />
                </div>
                <button
                  className="btn btn-ghost disparo-btn-search"
                  onClick={handleBuscaContato}
                  disabled={isSearching}
                >
                  {isSearching ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <Search size={16} />
                  )}
                </button>
              </div>

              {/* Resultados da busca */}
              {contatosBuscados.length > 0 && (
                <div className="disparo-search-results">
                  {contatosBuscados.map((c, i) => (
                    <div
                      key={`${c.cnpj}-${i}`}
                      className="disparo-search-item"
                    >
                      <div>
                        <span className="text-xs font-mono text-[var(--fg-dim)]">
                          {fmtCNPJ(c.cnpj)}
                        </span>
                        <span className="text-xs text-[var(--fg-muted)] ml-2">
                          {c.telefone}
                        </span>
                      </div>
                      <button
                        className="disparo-add-btn"
                        onClick={() => handleAdicionarContato(c)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Contatos Selecionados (mini-lista) */}
            {contatosSelecionados.length > 0 && (
              <div className="disparo-selected-list">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-wider">
                    Contatos na fila
                  </span>
                  <button
                    className="text-xs text-[var(--danger)] hover:underline"
                    onClick={() => {
                      setContatosSelecionados([]);
                      setXlsxContatos([]);
                      setXlsxFileName("");
                    }}
                  >
                    Limpar todos
                  </button>
                </div>
                <div className="disparo-selected-scroll">
                  {contatosSelecionados.slice(0, 10).map((c, i) => (
                    <div key={`${c.cnpj}-${i}`} className="disparo-selected-chip">
                      <Hash size={10} />
                      <span className="font-mono text-[10px]">
                        {c.cnpj.replace(/\D/g, "").slice(-6)}
                      </span>
                      <button
                        onClick={() => handleRemoverContato(c.cnpj)}
                        className="disparo-chip-remove"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                  {contatosSelecionados.length > 10 && (
                    <span className="text-xs text-[var(--fg-dim)]">
                      +{contatosSelecionados.length - 10} mais
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Processar Contatos */}
            <button
              className="btn btn-primary w-full mt-4"
              onClick={handleProcessarContatos}
              disabled={isProcessing || contatosSelecionados.length === 0}
            >
              {isProcessing ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  Processando...
                </>
              ) : (
                <>
                  <ArrowRight size={16} />
                  Processar Contatos ({contatosSelecionados.length})
                </>
              )}
            </button>
          </section>

          {/* ── SEÇÃO 2: Estúdio de Mensagem ── */}
          <section className="card disparo-section">
            <div className="disparo-section-header">
              <div className="disparo-section-icon disparo-section-icon-green">
                <MessageSquare size={18} />
              </div>
              <h2 className="disparo-section-title">Estúdio de Mensagem</h2>
            </div>

            {/* Template Selector */}
            <div className="disparo-field">
              <label className="disparo-label">
                <FileSpreadsheet size={14} />
                Templates salvos
              </label>
              <div className="disparo-select-wrapper">
                <select
                  className="input disparo-select"
                  value={selectedTemplateId || ""}
                  onChange={(e) =>
                    e.target.value && handleTemplateSelect(e.target.value)
                  }
                >
                  <option value="">Selecionar template...</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      [{t.categoria}] {t.nome}
                    </option>
                  ))}
                </select>
                <ChevronDown className="disparo-select-chevron" size={16} />
              </div>
            </div>

            {/* Variáveis */}
            <div className="disparo-field">
              <label className="disparo-label">Variáveis dinâmicas</label>
              <div className="disparo-var-grid">
                {VARIAVEIS.map((v) => (
                  <button
                    key={v.tag}
                    className="disparo-var-btn"
                    onClick={() => insertVariable(v.tag)}
                    title={`Inserir ${v.tag}`}
                  >
                    <span className="disparo-var-tag">{v.tag}</span>
                    <span className="disparo-var-label">{v.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* TextArea */}
            <div className="disparo-field">
              <label className="disparo-label">Mensagem</label>
              <textarea
                ref={textareaRef}
                className="disparo-textarea"
                rows={8}
                placeholder="Escreva sua mensagem ou selecione um template..."
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
              />
              <div className="flex justify-between items-center mt-1">
                <span className="text-xs text-[var(--fg-dim)]">
                  {mensagem.length} caracteres
                </span>
              </div>
            </div>

            {/* Live Preview */}
            <div className="disparo-field">
              <label className="disparo-label">
                <Eye size={14} />
                Preview WhatsApp
              </label>
              <div className="disparo-preview-container">
                <div className="disparo-preview-header">
                  <div className="disparo-preview-avatar">iW</div>
                  <div>
                    <span className="text-sm font-semibold text-white">iWof Financeiro</span>
                    <span className="text-[10px] text-green-400 block">online</span>
                  </div>
                </div>
                <div className="disparo-preview-body">
                  <div className="disparo-preview-bubble">
                    <p className="disparo-preview-text whitespace-pre-wrap">
                      {previewMessage}
                    </p>
                    <div className="disparo-preview-meta">
                      <span>{new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="disparo-preview-checks">✓✓</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* COLUNA DIREITA: Review + Envio                             */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div className="disparo-col-right">
          <section className="card disparo-section">
            <div className="disparo-section-header">
              <div className="disparo-section-icon disparo-section-icon-purple">
                <Send size={18} />
              </div>
              <h2 className="disparo-section-title">Review de Envio</h2>
            </div>

            {/* Counters */}
            <div className="disparo-counters">
              <div className="disparo-counter disparo-counter-ok">
                <CheckCircle2 size={18} />
                <div>
                  <span className="disparo-counter-value">{destinatarios.length}</span>
                  <span className="disparo-counter-label">Destinatários</span>
                </div>
              </div>
              <div className="disparo-counter disparo-counter-warn">
                <AlertTriangle size={18} />
                <div>
                  <span className="disparo-counter-value">{ignorados.length}</span>
                  <span className="disparo-counter-label">Ignorados</span>
                </div>
              </div>
              <div className="disparo-counter disparo-counter-flag">
                <Phone size={18} />
                <div>
                  <span className="disparo-counter-value">
                    {destinatarios.filter((d) => d.divergentPhone).length}
                  </span>
                  <span className="disparo-counter-label">Tel. Divergente</span>
                </div>
              </div>
            </div>

            {/* Tabela de Destinatários */}
            {destinatarios.length > 0 ? (
              <div className="disparo-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Empresa</th>
                      <th>CNPJ</th>
                      <th>Telefone</th>
                      <th>Valor</th>
                      <th className="text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {destinatarios.map((d, i) => (
                      <tr key={`${d.cnpj}-${i}`}>
                        <td>
                          <span className="table-primary text-sm">
                            {d.nomeFantasia || d.razaoSocial || "—"}
                          </span>
                          <span className="table-secondary">
                            {d.primeiroNome}
                          </span>
                        </td>
                        <td className="table-mono text-xs">
                          {fmtCNPJ(d.cnpj)}
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            {d.divergentPhone && (
                              <span title="Telefone do XLSX difere do banco">
                                <AlertTriangle
                                  size={14}
                                  className="text-[var(--warning)] flex-shrink-0"
                                />
                              </span>
                            )}
                            <span className="table-mono text-xs">
                              {d.telefone}
                            </span>
                          </div>
                        </td>
                        <td className="text-right font-semibold text-sm">
                          {d.valorTotal
                            ? `R$ ${new Intl.NumberFormat("pt-BR", {
                                minimumFractionDigits: 2,
                              }).format(d.valorTotal)}`
                            : "—"}
                        </td>
                        <td className="text-center">
                          {d.encontradoNoBanco ? (
                            <span className="badge badge-success">
                              <CheckCircle2 size={12} /> OK
                            </span>
                          ) : (
                            <span className="badge badge-warning">
                              <AlertTriangle size={12} /> N/A
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="disparo-empty-state">
                <Users size={40} className="text-[var(--fg-dim)]" />
                <p className="text-sm text-[var(--fg-muted)] mt-2">
                  Processe os contatos para visualizar os destinatários
                </p>
              </div>
            )}

            {/* ── Barra de Progresso ── */}
            {(isSending || logs.length > 0) && (
              <div className="disparo-progress-section">
                <div className="disparo-progress-header">
                  <span className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-wider">
                    Progresso do Envio
                  </span>
                  <span className="text-xs text-[var(--fg-dim)]">
                    {progresso}/{totalEnvio} ({progressPercent.toFixed(0)}%)
                  </span>
                </div>
                <div className="disparo-progress-bar">
                  <div
                    className="disparo-progress-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="disparo-progress-stats">
                  <span className="text-[var(--success)] text-xs font-semibold">
                    ✅ {enviadosCount} enviados
                  </span>
                  <span className="text-[var(--danger)] text-xs font-semibold">
                    ❌ {errosCount} erros
                  </span>
                </div>
              </div>
            )}

            {/* ── Log de Execução ── */}
            {logs.length > 0 && (
              <div className="disparo-log-container">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-[var(--fg-muted)] uppercase tracking-wider">
                    Log de Execução
                  </span>
                  <button
                    className="text-xs text-[var(--fg-dim)] hover:text-[var(--fg)] transition-colors"
                    onClick={() => setLogs([])}
                  >
                    Limpar
                  </button>
                </div>
                <div className="disparo-log-scroll">
                  {logs.map((log, i) => (
                    <div
                      key={i}
                      className={`disparo-log-entry disparo-log-${log.type.toLowerCase()}`}
                    >
                      <span className="disparo-log-time">{log.timestamp}</span>
                      <span className="disparo-log-msg">{log.message}</span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>
            )}

            {/* ── Botões de Ação ── */}
            <div className="disparo-actions">
              {!isSending ? (
                <button
                  className="btn btn-primary disparo-btn-send"
                  onClick={handleIniciarDisparo}
                  disabled={
                    destinatarios.length === 0 || !mensagem.trim() || isSending
                  }
                >
                  <Zap size={18} />
                  Iniciar Disparo ({destinatarios.length})
                </button>
              ) : (
                <button
                  className="btn disparo-btn-cancel"
                  onClick={handleCancelarDisparo}
                >
                  <X size={18} />
                  Cancelar Envio
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
