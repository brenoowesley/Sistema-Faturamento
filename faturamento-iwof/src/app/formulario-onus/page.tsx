"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type FormEvent,
  type DragEvent,
} from "react";
import { useTheme } from "next-themes";
import {
  Building2,
  User,
  Calendar,
  DollarSign,
  FileText,
  Upload,
  Mail,
  CheckCircle2,
  AlertTriangle,
  Send,
  Loader2,
  Sun,
  Moon,
  X,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Paperclip,
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

function isPrazoExpirado(dataAgendamento: string): boolean {
  if (!dataAgendamento) return false;
  const [year, month, day] = dataAgendamento.split("-").map(Number);
  const selectedDate = new Date(year, month - 1, day);
  selectedDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (selectedDate >= today) return false;

  let businessDaysCount = 0;
  let currentDate = new Date(selectedDate);
  currentDate.setDate(currentDate.getDate() + 1);

  while (currentDate < today) {
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      businessDaysCount++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return businessDaysCount >= 2;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
const ACCEPTED_EXTENSIONS = ".pdf,.png,.jpg,.jpeg";

interface FormData {
  cnpj: string;
  nome_loja: string;
  nome_solicitante: string;
  nome_usuario: string;
  data_agendamento: string;
  descricao: string;
  valor: string;
  email_retorno: string;
}

interface FormErrors {
  cnpj?: string;
  nome_loja?: string;
  nome_solicitante?: string;
  nome_usuario?: string;
  data_agendamento?: string;
  descricao?: string;
  valor?: string;
  anexo?: string;
  email_retorno?: string;
}

type CnpjStatus = "idle" | "loading" | "found" | "not-found";

// Mobile stepper steps
const STEPS = [
  { id: 0, label: "Loja", icon: Building2 },
  { id: 1, label: "Ônus", icon: User },
  { id: 2, label: "Anexo", icon: Paperclip },
  { id: 3, label: "Contato", icon: Mail },
];

/* ================================================================
   COMPONENT
   ================================================================ */

export default function FormularioOnusPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileStep, setMobileStep] = useState(0);

  const [formData, setFormData] = useState<FormData>({
    cnpj: "",
    nome_loja: "",
    nome_solicitante: "",
    nome_usuario: "",
    data_agendamento: "",
    descricao: "",
    valor: "",
    email_retorno: "",
  });

  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [anexo, setAnexo] = useState<File | null>(null);
  const [cnpjStatus, setCnpjStatus] = useState<CnpjStatus>("idle");
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const updateField = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (formErrors[key as keyof FormErrors]) {
      setFormErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

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

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  const validateStep = (step: number): boolean => {
    const errors: FormErrors = {};
    if (step === 0) {
      if (cnpjDigits(formData.cnpj).length < 14) errors.cnpj = "CNPJ inválido (14 dígitos).";
      if (!formData.nome_loja.trim()) errors.nome_loja = "Nome da loja é obrigatório.";
      if (!formData.nome_solicitante.trim()) errors.nome_solicitante = "Nome do solicitante é obrigatório.";
    }
    if (step === 1) {
      if (!formData.nome_usuario.trim()) errors.nome_usuario = "Nome do usuário é obrigatório.";
      if (!formData.data_agendamento) errors.data_agendamento = "Data é obrigatória.";
      if (!formData.descricao.trim()) errors.descricao = "Descrição é obrigatória.";
      if (!formData.valor || parseBRL(formData.valor) <= 0) errors.valor = "Valor deve ser maior que zero.";
    }
    if (step === 2) {
      if (!anexo) errors.anexo = "O anexo do termo assinado é obrigatório.";
    }
    if (step === 3) {
      if (formData.email_retorno && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email_retorno))
        errors.email_retorno = "E-mail inválido.";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateAll = (): boolean => {
    const errors: FormErrors = {};
    if (cnpjDigits(formData.cnpj).length < 14) errors.cnpj = "CNPJ inválido (14 dígitos).";
    if (!formData.nome_loja.trim()) errors.nome_loja = "Nome da loja é obrigatório.";
    if (!formData.nome_solicitante.trim()) errors.nome_solicitante = "Nome do solicitante é obrigatório.";
    if (!formData.nome_usuario.trim()) errors.nome_usuario = "Nome do usuário é obrigatório.";
    if (!formData.data_agendamento) errors.data_agendamento = "Data é obrigatória.";
    if (!formData.descricao.trim()) errors.descricao = "Descrição é obrigatória.";
    if (!formData.valor || parseBRL(formData.valor) <= 0) errors.valor = "Valor deve ser maior que zero.";
    if (!anexo) errors.anexo = "O anexo do termo assinado é obrigatório.";
    if (formData.email_retorno && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email_retorno))
      errors.email_retorno = "E-mail inválido.";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleMobileNext = () => {
    if (!validateStep(mobileStep)) return;
    setMobileStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    setSubmitError(null);
    if (!validateAll()) return;
    setIsSubmitting(true);
    try {
      const fd = new window.FormData();
      fd.append("cnpj_loja", cnpjDigits(formData.cnpj));
      fd.append("nome_loja", formData.nome_loja);
      fd.append("nome_solicitante", formData.nome_solicitante);
      fd.append("nome_usuario", formData.nome_usuario);
      fd.append("data_agendamento", formData.data_agendamento);
      fd.append("descricao", formData.descricao);
      fd.append("valor", parseBRL(formData.valor).toFixed(2));
      fd.append("canal_recebimento", "formulario");
      if (formData.email_retorno) fd.append("email_solicitante", formData.email_retorno);
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

  const resetForm = () => {
    setSubmitSuccess(false);
    setFormData({ cnpj: "", nome_loja: "", nome_solicitante: "", nome_usuario: "", data_agendamento: "", descricao: "", valor: "", email_retorno: "" });
    setAnexo(null);
    setCnpjStatus("idle");
    setMobileStep(0);
    setFormErrors({});
    setSubmitError(null);
  };

  /* ================================================================
     SUCCESS SCREEN
     ================================================================ */
  if (submitSuccess) {
    return (
      <div style={styles.page}>
        <div style={styles.successWrap}>
          <div style={styles.successCard}>
            <div style={styles.successIcon}>
              <CheckCircle2 size={40} color="#10b981" strokeWidth={2} />
            </div>
            <h2 style={styles.successTitle}>Formulário Enviado!</h2>
            <p style={styles.successSub}>Seu registro de ônus foi recebido com sucesso.</p>

            <div style={styles.summaryCard}>
              <SummaryRow label="CNPJ" value={formData.cnpj} />
              <SummaryRow label="Loja" value={formData.nome_loja} />
              <SummaryRow label="Usuário" value={formData.nome_usuario} />
              <SummaryRow label="Data" value={formData.data_agendamento.split("-").reverse().join("/")} />
              <SummaryRow label="Valor" value={`R$ ${formData.valor}`} />
              {anexo && <SummaryRow label="Anexo" value={anexo.name} />}
            </div>

            <button onClick={resetForm} style={styles.btnPrimary}>
              <ArrowLeft size={18} />
              Enviar Novo Formulário
            </button>
          </div>
          <p style={styles.footer}>Powered by IWOF • Sistema de Faturamento</p>
        </div>
        <GlobalStyles />
      </div>
    );
  }

  /* ================================================================
     HEADER (shared)
     ================================================================ */
  const header = (
    <header style={styles.header}>
      <div style={styles.headerLeft}>
        {mounted && (
          <img
            src={theme === "dark" ? "https://i.imgur.com/ag93VEM.png" : "https://i.imgur.com/MKGrpJX.png"}
            alt="IWOF"
            style={{ height: 40, width: "auto" }}
          />
        )}
        <div>
          <h1 style={styles.headerTitle}>Formulário de Ônus a Usuário</h1>
          <p style={styles.headerSub}>Registre um novo ônus de forma rápida e segura</p>
        </div>
      </div>
      {mounted && (
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          style={styles.themeBtn}
          title="Alternar tema"
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      )}
    </header>
  );

  /* ================================================================
     FIELD BLOCKS (reused in both desktop/mobile)
     ================================================================ */

  const fieldLoja = (
    <>
      <FieldGroup label="CNPJ da Loja" required error={formErrors.cnpj}>
        <div style={styles.inputWrap}>
          <span style={styles.inputIcon}><Building2 size={18} /></span>
          <input
            style={styles.input}
            placeholder="00.000.000/0000-00"
            inputMode="numeric"
            value={formData.cnpj}
            onChange={(e) => updateField("cnpj", formatCNPJ(e.target.value))}
            onBlur={handleCnpjBlur}
          />
          <span style={styles.inputRight}>
            {cnpjStatus === "loading" && <Loader2 size={18} style={{ color: "var(--accent, #6366f1)", animation: "spin 1s linear infinite" }} />}
            {cnpjStatus === "found" && <CheckCircle2 size={18} color="#10b981" />}
            {cnpjStatus === "not-found" && <AlertTriangle size={18} color="#f59e0b" />}
          </span>
        </div>
        {cnpjStatus === "not-found" && (
          <p style={styles.warnText}><AlertTriangle size={12} /> Loja não encontrada. Preencha manualmente.</p>
        )}
      </FieldGroup>

      <FieldGroup label="Nome Conta Azul" required error={formErrors.nome_loja}>
        <div style={{
          ...styles.inputWrap,
          opacity: cnpjStatus === "not-found" ? 1 : 0.55,
          cursor: cnpjStatus === "not-found" ? "text" : "not-allowed",
        }}>
          <span style={styles.inputIcon}><Building2 size={18} /></span>
          <input
            style={{ ...styles.input, cursor: cnpjStatus === "not-found" ? "text" : "not-allowed" }}
            placeholder="Preenchido automaticamente pelo CNPJ"
            value={formData.nome_loja}
            readOnly={cnpjStatus !== "not-found"}
            onChange={(e) => updateField("nome_loja", e.target.value)}
          />
        </div>
        {cnpjStatus !== "not-found" && (
          <p style={{ fontSize: 11, color: "var(--fg-dim, #64748b)", margin: "4px 0 0" }}>
            Preenchido automaticamente após consulta do CNPJ
          </p>
        )}
      </FieldGroup>

      <FieldGroup label="Nome do Solicitante" required error={formErrors.nome_solicitante}>
        <div style={styles.inputWrap}>
          <span style={styles.inputIcon}><User size={18} /></span>
          <input
            style={styles.input}
            placeholder="Digite o seu nome completo aqui"
            autoComplete="name"
            value={formData.nome_solicitante}
            onChange={(e) => updateField("nome_solicitante", e.target.value)}
          />
        </div>
      </FieldGroup>
    </>
  );

  const fieldOnus = (
    <>
      <FieldGroup label="Nome do Usuário" required error={formErrors.nome_usuario}>
        <div style={styles.inputWrap}>
          <span style={styles.inputIcon}><User size={18} /></span>
          <input
            style={styles.input}
            placeholder="Nome completo do usuário"
            autoComplete="name"
            value={formData.nome_usuario}
            onChange={(e) => updateField("nome_usuario", e.target.value)}
          />
        </div>
      </FieldGroup>

      <FieldGroup label="Data do Agendamento" required error={formErrors.data_agendamento}>
        <div style={{ ...styles.inputWrap, borderColor: isPrazoExpirado(formData.data_agendamento) ? "#f59e0b" : undefined }}>
          <span style={styles.inputIcon}><Calendar size={18} /></span>
          <input
            type="date"
            style={styles.input}
            value={formData.data_agendamento}
            onChange={(e) => updateField("data_agendamento", e.target.value)}
          />
        </div>
        {isPrazoExpirado(formData.data_agendamento) && (
          <p style={{ fontSize: 11, color: "#f59e0b", margin: "4px 0 0", display: "flex", alignItems: "center", gap: 4 }}>
            <AlertTriangle size={12} /> Prazo de 48h de envio excedido. O pedido irá para análise, mas pode ser negado.
          </p>
        )}
      </FieldGroup>

      <FieldGroup label="Descrição" required error={formErrors.descricao}>
        <div style={styles.inputWrap}>
          <span style={{ ...styles.inputIcon, alignSelf: "flex-start", paddingTop: 14 }}><FileText size={18} /></span>
          <textarea
            style={{ ...styles.input, minHeight: 110, paddingTop: 14, paddingBottom: 14, resize: "vertical", border: "none", borderRadius: 0 }}
            placeholder="Descreva o motivo do ônus..."
            value={formData.descricao}
            onChange={(e) => updateField("descricao", e.target.value)}
            rows={4}
          />
        </div>
      </FieldGroup>

      <FieldGroup label="Valor (R$)" required error={formErrors.valor}>
        <div style={styles.inputWrap}>
          <span style={styles.inputIcon}><DollarSign size={18} /></span>
          <input
            style={{ ...styles.input, fontSize: 20, fontWeight: 700, letterSpacing: 1 }}
            placeholder="0,00"
            inputMode="numeric"
            value={formData.valor}
            onChange={(e) => updateField("valor", formatBRL(e.target.value))}
          />
        </div>
      </FieldGroup>
    </>
  );

  const fieldAnexo = (
    <FieldGroup label="Anexo (Termo Assinado)" required error={formErrors.anexo}>
      <div
        style={{
          ...styles.dropzone,
          borderColor: isDragging ? "var(--accent, #6366f1)" : formErrors.anexo ? "#ef4444" : "var(--border-light, #334155)",
          background: isDragging ? "rgba(99,102,241,0.08)" : "var(--bg, #0f172a)",
          transform: isDragging ? "scale(1.01)" : "scale(1)",
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: "none" }}
          accept={ACCEPTED_EXTENSIONS}
          onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
        />
        {anexo ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <FileText size={28} color="#10b981" />
            <div style={{ flex: 1, textAlign: "left" }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--fg, #f1f5f9)", margin: 0 }}>{anexo.name}</p>
              <p style={{ fontSize: 12, color: "var(--fg-dim, #64748b)", margin: 0 }}>{(anexo.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setAnexo(null); }}
              style={styles.removeBtn}
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <>
            <div style={styles.uploadIconWrap}>
              <Upload size={28} color="var(--fg-dim, #64748b)" />
            </div>
            <p style={styles.dropText}>
              Arraste o arquivo ou{" "}
              <span style={{ color: "var(--accent, #6366f1)", fontWeight: 600 }}>clique para selecionar</span>
            </p>
            <p style={styles.dropSub}>PDF, PNG ou JPG • Máximo 10MB</p>
          </>
        )}
      </div>
    </FieldGroup>
  );

  const fieldContato = (
    <FieldGroup label="E-mail para retorno" error={formErrors.email_retorno}>
      <div style={styles.inputWrap}>
        <span style={styles.inputIcon}><Mail size={18} /></span>
        <input
          type="email"
          style={styles.input}
          placeholder="Insira e-mail do responsável financeiro para acompanhar a solicitação"
          autoComplete="email"
          inputMode="email"
          value={formData.email_retorno}
          onChange={(e) => updateField("email_retorno", e.target.value)}
        />
      </div>
      <p style={styles.hintText}>Opcional — o responsável receberá uma confirmação por e-mail.</p>
    </FieldGroup>
  );

  /* ================================================================
     ERROR BANNER
     ================================================================ */
  const errorBanner = submitError && (
    <div style={styles.errorBanner}>
      <AlertTriangle size={18} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{submitError}</span>
      <button type="button" onClick={() => setSubmitError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 4 }}>
        <X size={14} />
      </button>
    </div>
  );

  /* ================================================================
     DESKTOP LAYOUT
     ================================================================ */
  if (!isMobile) {
    return (
      <div style={styles.page}>
        <GlobalStyles />
        {header}

        <div style={styles.desktopBody}>
          <form onSubmit={handleSubmit} noValidate>
            {/* Single-column layout */}
            <div style={styles.desktopGrid}>
              <SectionCard icon={<Building2 size={18} />} title="Identificação da Loja" accent="#6366f1">
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {fieldLoja}
                </div>
              </SectionCard>

              <SectionCard icon={<User size={18} />} title="Dados do Ônus" accent="#06b6d4">
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {fieldOnus}
                </div>
              </SectionCard>

              <SectionCard icon={<Paperclip size={18} />} title="Anexo" accent="#8b5cf6">
                {fieldAnexo}
              </SectionCard>

              <SectionCard icon={<Mail size={18} />} title="Contato" accent="#10b981">
                {fieldContato}
              </SectionCard>
            </div>

            {/* Submit */}
            <div style={{ marginTop: 32 }}>
              {errorBanner}
              <button
                type="submit"
                disabled={isSubmitting}
                style={{ ...styles.btnPrimary, marginTop: errorBanner ? 12 : 0, width: "100%", padding: "18px 32px", fontSize: 16 }}
              >
                {isSubmitting ? <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} /> : <><Send size={18} />Enviar Formulário</>}
              </button>
            </div>
          </form>

          <p style={styles.footer}>Powered by IWOF • Sistema de Faturamento</p>
        </div>
      </div>
    );
  }

  /* ================================================================
     MOBILE LAYOUT — 4-step stepper
     ================================================================ */
  const stepContent = [fieldLoja, fieldOnus, fieldAnexo, fieldContato];
  const stepFields = [
    { title: "Identificação da Loja", icon: Building2, accent: "#6366f1" },
    { title: "Dados do Ônus", icon: User, accent: "#06b6d4" },
    { title: "Anexo", icon: Paperclip, accent: "#8b5cf6" },
    { title: "Contato", icon: Mail, accent: "#10b981" },
  ];
  const currentStep = stepFields[mobileStep];
  const StepIcon = currentStep.icon;
  const isLastStep = mobileStep === STEPS.length - 1;

  return (
    <div style={styles.page}>
      <GlobalStyles />
      {header}

      {/* Progress stepper */}
      <div style={styles.stepperBar}>
        {STEPS.map((step, idx) => {
          const SIcon = step.icon;
          const isDone = idx < mobileStep;
          const isActive = idx === mobileStep;
          return (
            <div key={step.id} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                <div style={{
                  ...styles.stepCircle,
                  background: isDone ? "#10b981" : isActive ? "var(--accent, #6366f1)" : "var(--bg-card, #1e293b)",
                  border: `2px solid ${isDone ? "#10b981" : isActive ? "var(--accent, #6366f1)" : "var(--border, #334155)"}`,
                  transform: isActive ? "scale(1.15)" : "scale(1)",
                  transition: "all 0.25s ease",
                }}>
                  {isDone ? <CheckCircle2 size={16} color="white" /> : <SIcon size={16} color={isActive ? "white" : "var(--fg-dim, #64748b)"} />}
                </div>
                <span style={{
                  fontSize: 10,
                  fontWeight: isActive ? 700 : 500,
                  marginTop: 4,
                  color: isActive ? "var(--accent, #6366f1)" : isDone ? "#10b981" : "var(--fg-dim, #64748b)",
                  transition: "color 0.25s ease",
                }}>
                  {step.label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div style={{
                  height: 2,
                  flex: 0.5,
                  background: idx < mobileStep ? "#10b981" : "var(--border, #334155)",
                  borderRadius: 2,
                  marginBottom: 18,
                  transition: "background 0.3s ease",
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div style={styles.mobileBody}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div style={{ ...styles.stepIconBig, background: `${currentStep.accent}22`, border: `1.5px solid ${currentStep.accent}55` }}>
            <StepIcon size={22} color={currentStep.accent} />
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-dim, #64748b)", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
              Etapa {mobileStep + 1} de {STEPS.length}
            </p>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--fg, #f1f5f9)", margin: 0, letterSpacing: "-0.02em" }}>
              {currentStep.title}
            </h2>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 120 }}>
          {stepContent[mobileStep]}
        </div>
      </div>

      {/* Fixed bottom nav */}
      <div style={styles.mobileBottomBar}>
        {errorBanner}
        <div style={{ display: "flex", gap: 12, marginTop: errorBanner ? 12 : 0 }}>
          {mobileStep > 0 && (
            <button
              type="button"
              onClick={() => { setMobileStep((s) => s - 1); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              style={styles.btnSecondary}
            >
              <ArrowLeft size={18} />
              Voltar
            </button>
          )}
          {!isLastStep ? (
            <button
              type="button"
              onClick={handleMobileNext}
              style={{ ...styles.btnPrimary, flex: 1 }}
            >
              Próximo
              <ArrowRight size={18} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={isSubmitting}
              style={{ ...styles.btnPrimary, flex: 1 }}
            >
              {isSubmitting
                ? <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
                : <><Send size={18} />Enviar Formulário</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   SUB-COMPONENTS
   ================================================================ */

function SectionCard({
  icon, title, accent, children,
}: {
  icon: React.ReactNode;
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div style={styles.sectionCard}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <div style={{
          padding: 8,
          borderRadius: 10,
          background: `${accent}18`,
          border: `1px solid ${accent}40`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: accent,
        }}>
          {icon}
        </div>
        <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--fg-muted, #94a3b8)", margin: 0 }}>
          {title}
        </h2>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {children}
      </div>
    </div>
  );
}

function FieldGroup({
  label, required, error, children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={styles.label}>
        {label}
        {required && <span style={{ color: "#ef4444", marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {error && (
        <p style={styles.errorText}>
          <AlertTriangle size={12} />
          {error}
        </p>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, padding: "8px 0", borderBottom: "1px solid var(--border, #334155)" }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-dim, #64748b)" }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, textAlign: "right", color: "var(--fg, #f1f5f9)" }}>{value}</span>
    </div>
  );
}

/* ================================================================
   GLOBAL STYLES
   ================================================================ */
function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
      * { box-sizing: border-box; font-family: 'Inter', system-ui, sans-serif; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
    `}</style>
  );
}

/* ================================================================
   STYLE OBJECTS
   ================================================================ */
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "var(--bg, #0f172a)",
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: "1px solid var(--border, #1e293b)",
    background: "var(--bg, #0f172a)",
    position: "sticky" as const,
    top: 0,
    zIndex: 50,
    backdropFilter: "blur(12px)",
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 12 },
  headerTitle: { fontSize: 17, fontWeight: 800, color: "var(--fg, #f1f5f9)", margin: 0, letterSpacing: "-0.02em" },
  headerSub: { fontSize: 12, color: "var(--fg-dim, #64748b)", margin: 0, marginTop: 2 },
  themeBtn: {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid var(--border, #334155)",
    background: "var(--bg-card, #1e293b)",
    color: "var(--fg-dim, #64748b)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
  },

  // Desktop
  desktopBody: { maxWidth: 720, margin: "0 auto", padding: "40px 32px 60px" },
  desktopGrid: { display: "flex", flexDirection: "column", gap: 24 },
  sectionCard: {
    background: "var(--bg-card, #1e293b)",
    border: "1px solid var(--border, #334155)",
    borderRadius: 20,
    padding: 28,
    boxShadow: "0 4px 32px rgba(0,0,0,0.15)",
  },

  // Mobile stepper
  stepperBar: {
    display: "flex",
    alignItems: "flex-start",
    padding: "16px 20px 8px",
    background: "var(--bg, #0f172a)",
    borderBottom: "1px solid var(--border, #1e293b)",
  },
  stepCircle: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  stepIconBig: {
    width: 48,
    height: 48,
    borderRadius: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  mobileBody: { padding: "24px 20px 0" },
  mobileBottomBar: {
    position: "fixed" as const,
    bottom: 0,
    left: 0,
    right: 0,
    padding: "16px 20px",
    background: "var(--bg, #0f172a)",
    borderTop: "1px solid var(--border, #1e293b)",
    backdropFilter: "blur(16px)",
    zIndex: 100,
    boxShadow: "0 -8px 32px rgba(0,0,0,0.3)",
  },

  // Inputs — padrão: bordered flex container, ícone e input são flex items
  inputWrap: {
    display: "flex",
    alignItems: "center",
    background: "var(--bg, #0f172a)",
    border: "1.5px solid var(--border, #334155)",
    borderRadius: 12,
    overflow: "hidden" as const,
    transition: "border-color 0.2s",
  },
  // Ícone como flex item (sem position absolute — sem conflito)
  inputIcon: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    padding: "0 10px 0 14px",
    color: "var(--fg-dim, #64748b)",
    pointerEvents: "none" as const,
  },
  // Status badge direito (CNPJ)
  inputRight: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    padding: "0 14px 0 8px",
    color: "var(--fg-dim, #64748b)",
  },
  // Input sem borda própria — borda está no inputWrap
  input: {
    flex: 1,
    minWidth: 0,
    background: "transparent",
    border: "none",
    outline: "none",
    padding: "14px 14px 14px 0",
    fontSize: 15,
    color: "var(--fg, #f1f5f9)",
  },
  label: {
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
    color: "var(--fg-dim, #64748b)",
  },
  errorText: {
    fontSize: 12,
    color: "#ef4444",
    display: "flex",
    alignItems: "center",
    gap: 4,
    margin: 0,
  },
  warnText: {
    fontSize: 12,
    color: "#f59e0b",
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  hintText: {
    fontSize: 12,
    color: "var(--fg-dim, #64748b)",
    margin: 0,
  },

  // Dropzone
  dropzone: {
    borderRadius: 16,
    border: "2px dashed",
    padding: "32px 24px",
    textAlign: "center" as const,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  uploadIconWrap: { marginBottom: 12, display: "flex", justifyContent: "center" },
  dropText: { fontSize: 14, color: "var(--fg-muted, #94a3b8)", margin: "0 0 6px" },
  dropSub: { fontSize: 12, color: "var(--fg-dim, #64748b)", margin: 0 },
  removeBtn: {
    background: "rgba(239,68,68,0.1)",
    border: "none",
    borderRadius: 8,
    padding: 8,
    cursor: "pointer",
    color: "#ef4444",
    display: "flex",
    alignItems: "center",
  },

  // Buttons
  btnPrimary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    color: "white",
    border: "none",
    borderRadius: 14,
    padding: "16px 28px",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 20px rgba(99,102,241,0.4)",
    transition: "all 0.2s ease",
    letterSpacing: "0.01em",
  },
  btnSecondary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: "var(--bg-card, #1e293b)",
    color: "var(--fg, #f1f5f9)",
    border: "1.5px solid var(--border, #334155)",
    borderRadius: 14,
    padding: "16px 20px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },

  // Success
  successWrap: { minHeight: "100vh", display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", padding: 24 },
  successCard: {
    background: "var(--bg-card, #1e293b)",
    border: "1px solid var(--border, #334155)",
    borderRadius: 24,
    padding: "40px 32px",
    maxWidth: 480,
    width: "100%",
    textAlign: "center" as const,
    boxShadow: "0 25px 60px rgba(0,0,0,0.3)",
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: "50%",
    background: "rgba(16,185,129,0.15)",
    border: "2px solid rgba(16,185,129,0.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 24px",
  },
  successTitle: { fontSize: 24, fontWeight: 800, color: "var(--fg, #f1f5f9)", margin: "0 0 8px", letterSpacing: "-0.03em" },
  successSub: { fontSize: 14, color: "var(--fg-dim, #64748b)", margin: "0 0 28px" },
  summaryCard: {
    background: "var(--bg, #0f172a)",
    border: "1px solid var(--border, #334155)",
    borderRadius: 16,
    padding: "16px 20px",
    marginBottom: 28,
    textAlign: "left" as const,
  },

  // Error
  errorBanner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderRadius: 12,
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.3)",
    color: "#ef4444",
    fontSize: 13,
    marginBottom: 0,
    animation: "fadeUp 0.25s ease",
  },

  footer: { textAlign: "center" as const, fontSize: 12, color: "var(--fg-dim, #64748b)", marginTop: 40 },
};
