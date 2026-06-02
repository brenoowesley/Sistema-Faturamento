"use client";

import { useState, useRef, useCallback, useEffect, type FormEvent, type DragEvent } from "react";
import { useTheme } from "next-themes";
import {
  Building2,
  User,
  Calendar,
  DollarSign,
  FileText,
  Upload,
  Mail,
  Link2,
  CheckCircle2,
  AlertTriangle,
  Send,
  Loader2,
  Sun,
  Moon,
  X,
  ChevronDown,
  Sparkles,
  ArrowLeft,
} from "lucide-react";

/* ================================================================
   UTILITY FUNCTIONS
   ================================================================ */

function formatCNPJ(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8)
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12)
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function formatBRL(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const numeric = parseInt(digits, 10);
  const reais = Math.floor(numeric / 100);
  const centavos = numeric % 100;
  const reaisFormatted = reais.toLocaleString("pt-BR");
  return `${reaisFormatted},${centavos.toString().padStart(2, "0")}`;
}

function parseBRL(formatted: string): number {
  const digits = formatted.replace(/\D/g, "");
  if (!digits) return 0;
  return parseInt(digits, 10) / 100;
}

function cnpjDigits(value: string): string {
  return value.replace(/\D/g, "");
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
const ACCEPTED_EXTENSIONS = ".pdf,.png,.jpg,.jpeg";

type CanalRecebimento = "formulario" | "tasky" | "email" | "outros";

interface FormData {
  cnpj: string;
  nome_loja: string;
  nome_usuario: string;
  data_agendamento: string;
  descricao: string;
  valor: string;
  canal_recebimento: CanalRecebimento;
  link_tasky: string;
  email_retorno: string;
}

interface FormErrors {
  cnpj?: string;
  nome_loja?: string;
  nome_usuario?: string;
  data_agendamento?: string;
  descricao?: string;
  valor?: string;
  canal_recebimento?: string;
  link_tasky?: string;
  anexo?: string;
  email_retorno?: string;
}

type CnpjStatus = "idle" | "loading" | "found" | "not-found";

/* ================================================================
   COMPONENT
   ================================================================ */

export default function FormularioOnusPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const [formData, setFormData] = useState<FormData>({
    cnpj: "",
    nome_loja: "",
    nome_usuario: "",
    data_agendamento: "",
    descricao: "",
    valor: "",
    canal_recebimento: "formulario",
    link_tasky: "",
    email_retorno: "",
  });

  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [anexo, setAnexo] = useState<File | null>(null);
  const [cnpjStatus, setCnpjStatus] = useState<CnpjStatus>("idle");
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [visibleSections, setVisibleSections] = useState<boolean[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    // Stagger section animations
    const timers: NodeJS.Timeout[] = [];
    for (let i = 0; i < 6; i++) {
      timers.push(setTimeout(() => {
        setVisibleSections(prev => {
          const next = [...prev];
          next[i] = true;
          return next;
        });
      }, 100 + i * 80));
    }
    return () => timers.forEach(clearTimeout);
  }, []);

  /* ---- Field update ---- */
  const updateField = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    // Clear error on change
    if (formErrors[key]) {
      setFormErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  /* ---- CNPJ lookup ---- */
  const handleCnpjBlur = useCallback(async () => {
    const digits = cnpjDigits(formData.cnpj);
    if (digits.length < 14) return;

    setCnpjStatus("loading");
    try {
      const res = await fetch(`/api/onus/buscar-loja?cnpj=${digits}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.nome_loja) {
          updateField("nome_loja", data.nome_loja);
          setCnpjStatus("found");
        } else {
          setCnpjStatus("not-found");
        }
      } else {
        setCnpjStatus("not-found");
      }
    } catch {
      setCnpjStatus("not-found");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.cnpj]);

  /* ---- File handling ---- */
  const handleFileSelect = (file: File | null) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setFormErrors((prev) => ({ ...prev, anexo: "Formato não aceito. Use PDF, PNG ou JPG." }));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFormErrors((prev) => ({ ...prev, anexo: "Arquivo excede o limite de 10MB." }));
      return;
    }
    setAnexo(file);
    setFormErrors((prev) => ({ ...prev, anexo: undefined }));
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  /* ---- Validation ---- */
  const validateForm = (): boolean => {
    const errors: FormErrors = {};

    if (cnpjDigits(formData.cnpj).length < 14) errors.cnpj = "CNPJ inválido (14 dígitos).";
    if (!formData.nome_loja.trim()) errors.nome_loja = "Nome da loja é obrigatório.";
    if (!formData.nome_usuario.trim()) errors.nome_usuario = "Nome do usuário é obrigatório.";
    if (!formData.data_agendamento) errors.data_agendamento = "Data é obrigatória.";
    if (!formData.descricao.trim()) errors.descricao = "Descrição é obrigatória.";
    if (!formData.valor || parseBRL(formData.valor) <= 0) errors.valor = "Valor deve ser maior que zero.";
    if (formData.canal_recebimento === "tasky" && !formData.link_tasky.trim())
      errors.link_tasky = "Link do Tasky é obrigatório.";
    if (formData.canal_recebimento === "outros" && !anexo)
      errors.anexo = "Anexo é obrigatório para o canal 'Outros'.";
    if (formData.email_retorno && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email_retorno))
      errors.email_retorno = "E-mail inválido.";

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /* ---- Submit ---- */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const fd = new window.FormData();
      fd.append("cnpj", cnpjDigits(formData.cnpj));
      fd.append("nome_loja", formData.nome_loja);
      fd.append("nome_usuario", formData.nome_usuario);
      fd.append("data_agendamento", formData.data_agendamento);
      fd.append("descricao", formData.descricao);
      fd.append("valor", parseBRL(formData.valor).toFixed(2));
      fd.append("canal_recebimento", formData.canal_recebimento);
      if (formData.link_tasky) fd.append("link_tasky", formData.link_tasky);
      if (formData.email_retorno) fd.append("email_retorno", formData.email_retorno);
      if (anexo) fd.append("anexo", anexo);

      const res = await fetch("/api/onus/enviar", { method: "POST", body: fd });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Erro ${res.status}`);
      }

      setSubmitSuccess(true);
    } catch (err: any) {
      setSubmitError(err.message || "Erro ao enviar formulário. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ---- Canal labels ---- */
  const canalLabels: Record<CanalRecebimento, string> = {
    formulario: "Formulário de cadastro de ônus (auto-preenchido)",
    tasky: "Tasky",
    email: "E-mail",
    outros: "Outros",
  };

  /* ---- Section animation class ---- */
  const sectionClass = (index: number) =>
    `transition-all duration-500 ease-out ${
      visibleSections[index]
        ? "opacity-100 translate-y-0"
        : "opacity-0 translate-y-4"
    }`;

  /* ================================================================
     SUCCESS SCREEN
     ================================================================ */

  if (submitSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
        style={{ background: "var(--bg)" }}>
        {/* Ambient glows */}
        <div className="pointer-events-none absolute w-[500px] h-[500px] rounded-full top-[-100px] right-[-100px]"
          style={{ background: "radial-gradient(circle, var(--accent-glow), transparent 70%)" }} />
        <div className="pointer-events-none absolute w-[400px] h-[400px] rounded-full bottom-[-80px] left-[-80px]"
          style={{ background: "radial-gradient(circle, rgba(16,185,129,0.15), transparent 70%)" }} />

        <div className="relative z-10 w-full max-w-lg animate-[slideUp_0.5s_ease]">
          <div className="rounded-2xl p-8 md:p-10 text-center"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              boxShadow: "0 25px 60px rgba(0,0,0,0.15)",
            }}>
            {/* Animated checkmark */}
            <div className="mx-auto mb-6 w-20 h-20 rounded-full flex items-center justify-center animate-[bounceIn_0.6s_ease]"
              style={{ background: "var(--success-glow)" }}>
              <CheckCircle2 size={40} style={{ color: "var(--success)" }} strokeWidth={2} />
            </div>

            <h2 className="text-2xl font-bold mb-2" style={{ color: "var(--fg)" }}>
              Formulário Enviado!
            </h2>
            <p className="text-sm mb-8" style={{ color: "var(--fg-dim)" }}>
              Seu registro de ônus foi recebido com sucesso.
            </p>

            {/* Summary card */}
            <div className="rounded-xl p-5 text-left mb-8 space-y-3"
              style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
              <SummaryRow label="CNPJ" value={formData.cnpj} />
              <SummaryRow label="Loja" value={formData.nome_loja} />
              <SummaryRow label="Usuário" value={formData.nome_usuario} />
              <SummaryRow label="Data" value={formData.data_agendamento.split("-").reverse().join("/")} />
              <SummaryRow label="Valor" value={`R$ ${formData.valor}`} />
              <SummaryRow label="Canal" value={canalLabels[formData.canal_recebimento]} />
              {anexo && <SummaryRow label="Anexo" value={anexo.name} />}
            </div>

            <button
              onClick={() => {
                setSubmitSuccess(false);
                setFormData({
                  cnpj: "", nome_loja: "", nome_usuario: "", data_agendamento: "",
                  descricao: "", valor: "", canal_recebimento: "formulario",
                  link_tasky: "", email_retorno: "",
                });
                setAnexo(null);
                setCnpjStatus("idle");
              }}
              className="btn btn-primary w-full py-3.5 text-[15px]"
            >
              <ArrowLeft size={18} />
              Enviar Novo Formulário
            </button>
          </div>

          <p className="text-center text-xs mt-6" style={{ color: "var(--fg-dim)" }}>
            Powered by IWOF • Sistema de Faturamento
          </p>
        </div>
      </div>
    );
  }

  /* ================================================================
     MAIN FORM
     ================================================================ */

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* ── Background glows ── */}
      <div className="pointer-events-none absolute w-[500px] h-[500px] rounded-full top-[-100px] right-[-100px]"
        style={{ background: "radial-gradient(circle, var(--accent-glow), transparent 70%)" }} />
      <div className="pointer-events-none absolute w-[400px] h-[400px] rounded-full bottom-[-80px] left-[-80px]"
        style={{ background: "radial-gradient(circle, rgba(139,92,246,0.12), transparent 70%)" }} />

      {/* ── Header ── */}
      <header className="relative z-10 py-6 px-4 md:px-8 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-4">
          {mounted && (
            <img
              src={theme === "dark" ? "https://i.imgur.com/ag93VEM.png" : "https://i.imgur.com/MKGrpJX.png"}
              alt="IWOF Logo"
              className="h-10 md:h-12 w-auto"
            />
          )}
          <div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight" style={{ color: "var(--fg)" }}>
              Formulário de Ônus a Usuário
            </h1>
            <p className="text-xs md:text-sm" style={{ color: "var(--fg-dim)" }}>
              Registre um novo ônus de forma rápida e segura
            </p>
          </div>
        </div>

        {mounted && (
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-2.5 rounded-xl transition-colors"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--fg-muted)" }}
            title="Alternar tema"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        )}
      </header>

      {/* ── Form body ── */}
      <div className="relative z-10 max-w-2xl mx-auto px-4 md:px-6 py-8 md:py-12">
        <form onSubmit={handleSubmit} noValidate>
          {/* ── Section 1: Identification ── */}
          <div className={sectionClass(0)}>
            <SectionTitle icon={<Building2 size={18} />} title="Identificação da Loja" />
            <div className="rounded-xl p-5 md:p-6 mb-6 space-y-5"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>

              {/* CNPJ */}
              <FieldGroup label="CNPJ da Loja" required error={formErrors.cnpj}>
                <div className="input-wrapper">
                  <Building2 size={18} className="input-icon" />
                  <input
                    className="input"
                    placeholder="00.000.000/0000-00"
                    value={formData.cnpj}
                    onChange={(e) => updateField("cnpj", formatCNPJ(e.target.value))}
                    onBlur={handleCnpjBlur}
                  />
                  {/* CNPJ status indicator */}
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {cnpjStatus === "loading" && <Loader2 size={18} className="animate-spin" style={{ color: "var(--accent)" }} />}
                    {cnpjStatus === "found" && <CheckCircle2 size={18} style={{ color: "var(--success)" }} />}
                    {cnpjStatus === "not-found" && <AlertTriangle size={18} style={{ color: "var(--warning)" }} />}
                  </span>
                </div>
                {cnpjStatus === "not-found" && (
                  <p className="text-xs mt-1 flex items-center gap-1" style={{ color: "var(--warning)" }}>
                    <AlertTriangle size={12} /> Loja não encontrada. Preencha manualmente.
                  </p>
                )}
              </FieldGroup>

              {/* Nome da Loja */}
              <FieldGroup label="Nome da Loja" required error={formErrors.nome_loja}>
                <div className="input-wrapper">
                  <Building2 size={18} className="input-icon" />
                  <input
                    className="input"
                    placeholder="Nome da loja"
                    value={formData.nome_loja}
                    onChange={(e) => updateField("nome_loja", e.target.value)}
                  />
                </div>
              </FieldGroup>
            </div>
          </div>

          {/* ── Section 2: User / Date ── */}
          <div className={sectionClass(1)}>
            <SectionTitle icon={<User size={18} />} title="Dados do Ônus" />
            <div className="rounded-xl p-5 md:p-6 mb-6 space-y-5"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>

              {/* Nome do Usuário */}
              <FieldGroup label="Nome do Usuário" required error={formErrors.nome_usuario}>
                <div className="input-wrapper">
                  <User size={18} className="input-icon" />
                  <input
                    className="input"
                    placeholder="Nome completo do usuário"
                    value={formData.nome_usuario}
                    onChange={(e) => updateField("nome_usuario", e.target.value)}
                  />
                </div>
              </FieldGroup>

              {/* Data */}
              <FieldGroup label="Data do Agendamento" required error={formErrors.data_agendamento}>
                <div className="input-wrapper">
                  <Calendar size={18} className="input-icon" />
                  <input
                    type="date"
                    className="input"
                    value={formData.data_agendamento}
                    onChange={(e) => updateField("data_agendamento", e.target.value)}
                  />
                </div>
              </FieldGroup>

              {/* Descrição */}
              <FieldGroup label="Descrição" required error={formErrors.descricao}>
                <div className="relative">
                  <FileText size={18} className="absolute left-3.5 top-3.5" style={{ color: "var(--fg-dim)" }} />
                  <textarea
                    className="input min-h-[110px] resize-y !pl-11 !pt-3"
                    style={{ paddingLeft: "44px" }}
                    placeholder="Descreva o motivo do ônus..."
                    value={formData.descricao}
                    onChange={(e) => updateField("descricao", e.target.value)}
                    rows={4}
                  />
                </div>
              </FieldGroup>

              {/* Valor */}
              <FieldGroup label="Valor (R$)" required error={formErrors.valor}>
                <div className="input-wrapper">
                  <DollarSign size={18} className="input-icon" />
                  <input
                    className="input"
                    placeholder="0,00"
                    inputMode="numeric"
                    value={formData.valor}
                    onChange={(e) => updateField("valor", formatBRL(e.target.value))}
                  />
                </div>
              </FieldGroup>
            </div>
          </div>

          {/* ── Section 3: Canal ── */}
          <div className={sectionClass(2)}>
            <SectionTitle icon={<Sparkles size={18} />} title="Canal de Recebimento" />
            <div className="rounded-xl p-5 md:p-6 mb-6 space-y-5"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>

              <FieldGroup label="Canal de Recebimento" required error={formErrors.canal_recebimento}>
                <div className="input-wrapper">
                  <ChevronDown size={18} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--fg-dim)" }} />
                  <select
                    className="input appearance-none cursor-pointer !pl-3.5"
                    value={formData.canal_recebimento}
                    onChange={(e) => updateField("canal_recebimento", e.target.value as CanalRecebimento)}
                  >
                    <option value="formulario">Formulário de cadastro de ônus (auto-preenchido)</option>
                    <option value="tasky">Tasky</option>
                    <option value="email">E-mail</option>
                    <option value="outros">Outros</option>
                  </select>
                </div>
              </FieldGroup>

              {/* Conditional hints / fields */}
              <div className="overflow-hidden transition-all duration-300">
                {formData.canal_recebimento === "formulario" && (
                  <HintBadge color="accent" icon={<CheckCircle2 size={14} />}
                    text="Enviado via formulário externo — preenchimento automático." />
                )}

                {formData.canal_recebimento === "tasky" && (
                  <div className="animate-[slideUp_0.25s_ease]">
                    <FieldGroup label="Link do Tasky" required error={formErrors.link_tasky}>
                      <div className="input-wrapper">
                        <Link2 size={18} className="input-icon" />
                        <input
                          className="input"
                          placeholder="https://tasky.example.com/..."
                          value={formData.link_tasky}
                          onChange={(e) => updateField("link_tasky", e.target.value)}
                        />
                      </div>
                    </FieldGroup>
                  </div>
                )}

                {formData.canal_recebimento === "email" && (
                  <HintBadge color="accent" icon={<Mail size={14} />}
                    text="Anexe o formulário preenchido abaixo." />
                )}

                {formData.canal_recebimento === "outros" && (
                  <HintBadge color="warning" icon={<AlertTriangle size={14} />}
                    text="Necessário anexar evidência no campo abaixo." />
                )}
              </div>
            </div>
          </div>

          {/* ── Section 4: File upload ── */}
          <div className={sectionClass(3)}>
            <SectionTitle icon={<Upload size={18} />} title="Anexo" />
            <div className="rounded-xl p-5 md:p-6 mb-6"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>

              <FieldGroup
                label={`Anexo (Termo Assinado)${formData.canal_recebimento === "outros" ? " *" : ""}`}
                error={formErrors.anexo}
              >
                {/* Drop zone */}
                <div
                  className={`relative rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer p-6 md:p-8 text-center ${
                    isDragging ? "scale-[1.01]" : ""
                  }`}
                  style={{
                    borderColor: isDragging ? "var(--accent)" : formErrors.anexo ? "var(--danger)" : "var(--border-light)",
                    background: isDragging ? "var(--accent-glow)" : "var(--bg)",
                  }}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept={ACCEPTED_EXTENSIONS}
                    onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
                  />

                  {anexo ? (
                    <div className="flex items-center justify-center gap-3">
                      <FileText size={24} style={{ color: "var(--success)" }} />
                      <div className="text-left">
                        <p className="text-sm font-medium" style={{ color: "var(--fg)" }}>{anexo.name}</p>
                        <p className="text-xs" style={{ color: "var(--fg-dim)" }}>
                          {(anexo.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setAnexo(null); }}
                        className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
                        style={{ color: "var(--danger)" }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload size={28} className="mx-auto mb-3" style={{ color: "var(--fg-dim)" }} />
                      <p className="text-sm font-medium mb-1" style={{ color: "var(--fg-muted)" }}>
                        Arraste o arquivo ou <span style={{ color: "var(--accent)" }}>clique para selecionar</span>
                      </p>
                      <p className="text-xs" style={{ color: "var(--fg-dim)" }}>
                        PDF, PNG ou JPG • Máximo 10MB
                      </p>
                    </>
                  )}
                </div>
              </FieldGroup>
            </div>
          </div>

          {/* ── Section 5: Email ── */}
          <div className={sectionClass(4)}>
            <SectionTitle icon={<Mail size={18} />} title="Contato" />
            <div className="rounded-xl p-5 md:p-6 mb-6"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
              <FieldGroup label="E-mail para retorno" error={formErrors.email_retorno}>
                <div className="input-wrapper">
                  <Mail size={18} className="input-icon" />
                  <input
                    type="email"
                    className="input"
                    placeholder="Receba confirmação por e-mail"
                    value={formData.email_retorno}
                    onChange={(e) => updateField("email_retorno", e.target.value)}
                  />
                </div>
                <p className="text-xs mt-1.5" style={{ color: "var(--fg-dim)" }}>
                  Opcional — informe caso deseje receber uma confirmação.
                </p>
              </FieldGroup>
            </div>
          </div>

          {/* ── Submit ── */}
          <div className={sectionClass(5)}>
            {submitError && (
              <div className="rounded-xl p-4 mb-5 flex items-center gap-3 text-sm animate-[slideUp_0.25s_ease]"
                style={{
                  background: "var(--danger-glow)",
                  border: "1px solid var(--danger)",
                  color: "var(--danger)",
                }}>
                <AlertTriangle size={18} className="flex-shrink-0" />
                <span className="flex-1">{submitError}</span>
                <button type="button" onClick={() => setSubmitError(null)}
                  className="p-1 rounded hover:bg-red-500/20 transition-colors">
                  <X size={14} />
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary w-full py-4 text-[15px] font-semibold tracking-wide"
            >
              {isSubmitting ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <>
                  <Send size={18} />
                  Enviar Formulário
                </>
              )}
            </button>
          </div>
        </form>

        {/* ── Footer ── */}
        <p className="text-center text-xs mt-10 pb-6" style={{ color: "var(--fg-dim)" }}>
          Powered by IWOF • Sistema de Faturamento
        </p>
      </div>
    </div>
  );
}

/* ================================================================
   SUB-COMPONENTS
   ================================================================ */

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3 ml-1">
      <span style={{ color: "var(--accent)" }}>{icon}</span>
      <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--fg-muted)" }}>
        {title}
      </h2>
    </div>
  );
}

function FieldGroup({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="input-group">
      <label className="input-label">
        {label}
        {required && <span className="ml-0.5" style={{ color: "var(--danger)" }}>*</span>}
      </label>
      {children}
      {error && (
        <p className="text-xs flex items-center gap-1 mt-0.5 animate-[slideUp_0.2s_ease]" style={{ color: "var(--danger)" }}>
          <AlertTriangle size={12} />
          {error}
        </p>
      )}
    </div>
  );
}

function HintBadge({ color, icon, text }: { color: "accent" | "warning"; icon: React.ReactNode; text: string }) {
  const bgMap = { accent: "var(--info-glow)", warning: "var(--warning-glow)" };
  const fgMap = { accent: "var(--accent)", warning: "var(--warning)" };
  return (
    <div
      className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-medium animate-[slideUp_0.25s_ease]"
      style={{ background: bgMap[color], color: fgMap[color] }}
    >
      {icon}
      {text}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--fg-dim)" }}>
        {label}
      </span>
      <span className="text-sm text-right font-medium" style={{ color: "var(--fg)" }}>
        {value}
      </span>
    </div>
  );
}
