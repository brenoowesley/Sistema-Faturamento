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
  SkipForward,
  Mail,
  ArrowRight,
} from "lucide-react";
import * as xlsx from "xlsx";
import {
  processarContatos,
  buscarContatosDoBanco,
  buscarLotes,
  buscarCiclosParaFiltro,
  buscarEstadosUnicos,
  buscarContatosPorFiltro,
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
  const [canalDisparo, setCanalDisparo] = useState<"whatsapp" | "email">("whatsapp");

  // ── SEÇÃO 1.5: Filtros Avançados ──
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterCiclo, setFilterCiclo] = useState("");
  const [filterStatus, setFilterStatus] = useState<"todos" | "ativo" | "inativo">("todos");
  const [filterEstado, setFilterEstado] = useState("");
  const [ciclosList, setCiclosList] = useState<{ id: string; nome: string }[]>([]);
  const [estadosList, setEstadosList] = useState<string[]>([]);
  const [advancedResults, setAdvancedResults] = useState<{ cnpj: string; telefone: string; email: string; nome: string }[]>([]);
  const [advancedSelected, setAdvancedSelected] = useState<Set<string>>(new Set());
  const [isFiltering, setIsFiltering] = useState(false);

  // ── SEÇÃO 2: Estúdio de Mensagem ──
  const [mensagem, setMensagem] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [assuntoEmail, setAssuntoEmail] = useState("");
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

      // Buscar lotes, templates e filtros
      try {
        const [lotesData, templatesData, ciclosData, estadosData] = await Promise.all([
          buscarLotes(),
          supabase.from("whatsapp_templates").select("*").order("nome"),
          buscarCiclosParaFiltro(),
          buscarEstadosUnicos()
        ]);
        setLotes(lotesData as Lote[]);
        setTemplates(templatesData.data || []);
        setCiclosList(ciclosData);
        setEstadosList(estadosData);
      } catch (e) {
        console.error("Erro ao carregar dados iniciais:", e);
      }

      setLoading(false);
    }
    init();
  }, [supabase]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ── LIVE PREVIEW (must be before any conditional returns) ──
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
            email: Object.keys(row).find((k) => k.toLowerCase().includes("email") || k.toLowerCase().includes("e-mail")) 
                ? String(row[Object.keys(row).find((k) => k.toLowerCase().includes("email") || k.toLowerCase().includes("e-mail"))!]).trim() 
                : "",
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
      console.error(err);
      alert("Erro ao buscar contatos.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleFiltrarBaseAvancado = async () => {
    setIsFiltering(true);
    try {
      const res = await buscarContatosPorFiltro({
        cicloId: filterCiclo,
        status: filterStatus,
        estado: filterEstado,
      });
      setAdvancedResults(res);
      // Auto-select all by default
      setAdvancedSelected(new Set(res.map(c => c.cnpj)));
    } catch (err) {
      console.error(err);
      alert("Erro ao filtrar contatos.");
    } finally {
      setIsFiltering(false);
    }
  };

  const handleAdicionarSelecionadosAvancado = () => {
    const toAdd = advancedResults.filter(c => advancedSelected.has(c.cnpj));
    if (toAdd.length === 0) return;

    setContatosSelecionados((prev) => {
      const novafila = [...prev];
      toAdd.forEach((c) => {
        const jaExiste = novafila.some((ex) => ex.cnpj.replace(/\D/g, "") === c.cnpj.replace(/\D/g, ""));
        if (!jaExiste) {
          novafila.push({
            cnpj: c.cnpj,
            telefone: c.telefone,
            email: c.email
          });
        }
      });
      return novafila;
    });

    setShowAdvancedFilters(false);
    setAdvancedResults([]);
    setAdvancedSelected(new Set());
    setFilterCiclo("");
    setFilterEstado("");
    setFilterStatus("todos");
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
      const result = await processarContatos(contatosSelecionados, selectedLoteId, canalDisparo);
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
    if (canalDisparo === "email" && !assuntoEmail.trim()) {
      alert("Para envios por e-mail, informe o assunto da mensagem.");
      return;
    }
    if (
      !confirm(
        `Confirmar envio de ${destinatarios.length} mensagens via ${canalDisparo.toUpperCase()}?`
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
      const apiUrl = canalDisparo === "email" ? "/api/email/disparar" : "/api/whatsapp/disparar";
      const bodyPayload = canalDisparo === "email" 
          ? { destinatarios, mensagem, assunto: assuntoEmail, loteId: selectedLoteId, nomeLote }
          : { destinatarios, mensagem, loteId: selectedLoteId, nomeLote };

      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
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
          <div className="disparo-header-icon" style={{ background: canalDisparo === 'email' ? 'var(--accent-nf-alpha)' : '' }}>
            {canalDisparo === 'whatsapp' ? <MessageSquare size={24} /> : <Mail size={24} />}
          </div>
          <div>
            <h1 className="page-title flex items-center gap-2">
              Central de Disparos
              <span className={`disparo-badge-whatsapp ${canalDisparo === 'email' ? 'bg-blue-900 text-blue-300 border-blue-800' : ''}`}>
                {canalDisparo === 'whatsapp' ? 'WhatsApp' : 'E-mail'}
              </span>
            </h1>
            <p className="page-description">
              Envio em massa de notificações {canalDisparo === 'whatsapp' ? 'via Evolution API' : 'via E-mail (Nodemailer)'}
            </p>
          </div>
        </div>
        <div className="flex bg-[var(--bg-card)] p-1 rounded-lg border border-[var(--border-color)]">
           <button 
             className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${canalDisparo === 'whatsapp' ? 'bg-[var(--success-alpha)] text-[var(--success)]' : 'text-[var(--fg-muted)] hover:text-white'}`}
             onClick={() => setCanalDisparo('whatsapp')}
           >
             WhatsApp
           </button>
           <button 
             className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${canalDisparo === 'email' ? 'bg-[var(--accent-nf-alpha)] text-blue-400' : 'text-[var(--fg-muted)] hover:text-white'}`}
             onClick={() => setCanalDisparo('email')}
           >
             E-mail
           </button>
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

            {/* Filtros Avançados */}
            <div className="disparo-field">
              <label className="disparo-label cursor-pointer flex justify-between items-center" onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}>
                <span className="flex items-center gap-2">
                  <Filter size={14} />
                  Filtro Avançado da Base
                </span>
                <ChevronDown size={14} className={`transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
              </label>
              
              {showAdvancedFilters && (
                <div className="bg-[var(--bg-card)] border border-[var(--border-color)] p-4 rounded-lg flex flex-col gap-3 mt-2">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-[var(--fg-dim)] mb-1 block">Ciclo</label>
                      <select className="input w-full text-sm py-1 px-2 h-8" value={filterCiclo} onChange={e => setFilterCiclo(e.target.value)}>
                        <option value="">Todos</option>
                        {ciclosList.map(c => (
                          <option key={c.id} value={c.id}>{c.nome}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-[var(--fg-dim)] mb-1 block">Status</label>
                      <select className="input w-full text-sm py-1 px-2 h-8" value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}>
                        <option value="todos">Todos</option>
                        <option value="ativo">Ativos</option>
                        <option value="inativo">Inativos</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-[var(--fg-dim)] mb-1 block">Estado</label>
                      <select className="input w-full text-sm py-1 px-2 h-8" value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
                        <option value="">Todos</option>
                        {estadosList.map(est => (
                          <option key={est} value={est}>{est}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button 
                    className="btn btn-primary w-full h-8 flex justify-center items-center text-sm mt-1" 
                    onClick={handleFiltrarBaseAvancado}
                    disabled={isFiltering}
                  >
                    {isFiltering ? <RefreshCw size={14} className="animate-spin mr-2" /> : <Search size={14} className="mr-2" />}
                    Pesquisar Base
                  </button>

                  {advancedResults.length > 0 && (
                    <div className="mt-3 border-t border-[var(--border-color)] pt-3">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-semibold text-[var(--fg-muted)]">Resultados: {advancedResults.length}</span>
                        <button className="text-xs text-blue-400 hover:text-blue-300" onClick={() => {
                          if (advancedSelected.size === advancedResults.length) setAdvancedSelected(new Set());
                          else setAdvancedSelected(new Set(advancedResults.map(c => c.cnpj)));
                        }}>
                          {advancedSelected.size === advancedResults.length ? "Desmarcar Todos" : "Marcar Todos"}
                        </button>
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {advancedResults.map((c) => (
                          <label key={c.cnpj} className="flex items-center gap-2 p-1.5 hover:bg-[var(--bg-body)] rounded cursor-pointer transition-colors">
                            <input 
                              type="checkbox" 
                              checked={advancedSelected.has(c.cnpj)}
                              onChange={(e) => {
                                const newSet = new Set(advancedSelected);
                                if (e.target.checked) newSet.add(c.cnpj);
                                else newSet.delete(c.cnpj);
                                setAdvancedSelected(newSet);
                              }}
                            />
                            <div className="flex flex-col flex-1 overflow-hidden">
                              <span className="text-xs font-medium text-white truncate">{c.nome}</span>
                              <span className="text-[10px] text-[var(--fg-dim)]">{fmtCNPJ(c.cnpj)} • {c.email || c.telefone || 'Sem contato'}</span>
                            </div>
                          </label>
                        ))}
                      </div>
                      <button 
                        className="btn bg-[var(--success-alpha)] text-[var(--success)] w-full h-8 flex justify-center items-center text-sm mt-2 hover:bg-[var(--success)] hover:text-white transition-colors" 
                        onClick={handleAdicionarSelecionadosAvancado}
                        disabled={advancedSelected.size === 0}
                      >
                        <Plus size={14} className="mr-2" />
                        Adicionar {advancedSelected.size} à Fila
                      </button>
                    </div>
                  )}
                </div>
              )}
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
              <div className={`disparo-section-icon ${canalDisparo === 'whatsapp' ? 'disparo-section-icon-green' : 'disparo-section-icon-blue'}`}>
                {canalDisparo === 'whatsapp' ? <MessageSquare size={18} /> : <Mail size={18} />}
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

            {/* Assunto Email (Só aparece se canal for email) */}
            {canalDisparo === "email" && (
              <div className="disparo-field">
                <label className="disparo-label">Assunto do E-mail</label>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="Ex: Fatura disponível para {{nome_fantasia}}"
                  value={assuntoEmail}
                  onChange={(e) => setAssuntoEmail(e.target.value)}
                />
              </div>
            )}

            {/* TextArea */}
            <div className="disparo-field">
              <label className="disparo-label">{canalDisparo === "whatsapp" ? "Mensagem" : "Corpo do E-mail (Código HTML)"}</label>
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
                Preview {canalDisparo === "whatsapp" ? "WhatsApp" : "E-mail"}
              </label>
              <div className="disparo-preview-container" style={{ padding: canalDisparo === 'email' ? 0 : undefined, overflow: 'hidden' }}>
                {canalDisparo === "whatsapp" ? (
                  <>
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
                  </>
                ) : (
                  <div className="w-full h-64 bg-white">
                     <iframe 
                       srcDoc={previewMessage} 
                       style={{ width: '100%', height: '100%', border: 'none' }}
                       sandbox="allow-same-origin"
                     />
                  </div>
                )}
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
