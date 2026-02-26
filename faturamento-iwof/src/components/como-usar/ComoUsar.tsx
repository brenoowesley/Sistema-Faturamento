"use client";

/* ================================================================
   COMO USAR — GUIA INTERATIVO DO SISTEMA
   ================================================================ */

import { useState } from "react";
import {
    LayoutDashboard,
    Users,
    FilePlus,
    ReceiptText,
    ClipboardList,
    ChevronDown,
    ChevronRight,
    Lightbulb,
    AlertTriangle,
    CheckCircle2,
    BookOpen,
    FileSpreadsheet,
    Upload,
    Search,
    Link2,
    FileArchive,
    Download,
    SendHorizonal,
    MousePointerClick,
    Keyboard,
    ArrowRight,
    Info,
    Zap,
    Building2,
} from "lucide-react";

/* ─── Tipos ─── */

interface GuideStep {
    title: string;
    description: string;
    tip?: string;
    warning?: string;
}

interface ModuleGuide {
    id: string;
    title: string;
    description: string;
    icon: React.ReactNode;
    color: string;
    steps: GuideStep[];
    tips?: string[];
}

/* ─── Dados dos Módulos ─── */

const modules: ModuleGuide[] = [
    {
        id: "dashboard",
        title: "Dashboard",
        description: "Visão geral do sistema com métricas, gráficos e indicadores em tempo real.",
        icon: <LayoutDashboard size={22} />,
        color: "#818cf8",
        steps: [
            {
                title: "Acessar o Dashboard",
                description: "Ao entrar no sistema, o Dashboard é a primeira tela exibida. Ele mostra um resumo do faturamento, quantidade de clientes ativos e os lotes em andamento.",
            },
            {
                title: "Visualizar métricas",
                description: "Os cards no topo mostram os totalizadores: Total Faturado, Clientes Ativos, Lotes do Mês e Ticket Médio. Use os filtros de data para ajustar o período.",
            },
            {
                title: "Gráficos interativos",
                description: "Os gráficos mostram a evolução do faturamento ao longo do tempo e a distribuição por cargo/função. Passe o mouse sobre os pontos para ver detalhes.",
                tip: "Use o filtro de Cargos para focar em funções específicas no gráfico de Top Functions.",
            },
        ],
        tips: [
            "O Dashboard atualiza automaticamente a cada acesso.",
            "Utilize os filtros de data para análises de períodos específicos.",
        ],
    },
    {
        id: "clientes",
        title: "Gestão de Clientes",
        description: "Cadastro, importação e gerenciamento de clientes e suas informações fiscais.",
        icon: <Users size={22} />,
        color: "#34d399",
        steps: [
            {
                title: "Acessar a lista de clientes",
                description: "No menu lateral, clique em \"Clientes\". Você verá a lista completa com razão social, CNPJ, nome Conta Azul, e-mail e status.",
            },
            {
                title: "Buscar um cliente",
                description: "Use a barra de pesquisa no topo para filtrar por nome, CNPJ, razão social ou nome Conta Azul. A busca é instantânea.",
            },
            {
                title: "Importar clientes (planilha)",
                description: "Clique no botão \"Importar\" para abrir o wizard de importação. Arraste um arquivo CSV ou XLSX com os dados dos clientes. O sistema detecta automaticamente as colunas.",
                tip: "A planilha deve conter ao menos: Razão Social, CNPJ, E-mail. Colunas como endereço, cidade e estado são opcionais mas recomendadas.",
            },
            {
                title: "Editar um cliente",
                description: "Clique no ícone de edição ao lado de qualquer cliente para atualizar seus dados: razão social, CNPJ, e-mails, endereço, código IBGE, etc.",
                warning: "Alterações no CNPJ podem afetar o matching automático em módulos como Lançamentos Parciais.",
            },
            {
                title: "Ativar / Desativar cliente",
                description: "Clientes desativados não aparecem no faturamento. Use o toggle de status para controlar isso sem precisar excluir o cadastro.",
            },
        ],
        tips: [
            "O campo \"Nome Conta Azul\" é crucial para o matching automático no faturamento.",
            "Mantenha o código IBGE atualizado — ele é usado na exportação NFE.io.",
            "Importe clientes em lote para evitar cadastro manual um a um.",
        ],
    },
    {
        id: "faturamento",
        title: "Novo Faturamento",
        description: "Fluxo principal de faturamento: upload de planilha → pré-visualização → despacho para Conta Azul e NFE.io.",
        icon: <FilePlus size={22} />,
        color: "#f59e0b",
        steps: [
            {
                title: "Iniciar novo faturamento",
                description: "No menu lateral, clique em \"Novo Faturamento\". Selecione o ciclo/lote desejado ou crie um novo.",
            },
            {
                title: "Upload da planilha de horas",
                description: "Arraste ou selecione a planilha (CSV/XLSX) com os dados de horas e valores. O parser identifica automaticamente as colunas: Nome, Horas, Valor, etc.",
                tip: "Utilize a planilha exportada do sistema de controle de horas para melhores resultados.",
            },
            {
                title: "Pré-visualização e validação",
                description: "O sistema cruza os dados da planilha com o cadastro de clientes. Itens com divergência (CNPJ não encontrado, valor zerado) são marcados em vermelho.",
                warning: "Verifique TODOS os itens marcados como \"Divergentes\" antes de prosseguir. Lojas sem correspondência no banco não serão faturadas.",
            },
            {
                title: "Gerar arquivo NFE.io (.xlsx)",
                description: "Clique em \"Exportar NFE.io\" para gerar o arquivo XLSX com as 19 colunas padrão. Este arquivo deve ser importado manualmente no portal NFE.io.",
            },
            {
                title: "Despachar para GCP",
                description: "Clique em \"Disparar GCP\" para enviar os dados ao Google Cloud Platform, que automaticamente gera os boletos, atualiza o Conta Azul e cria as pastas no Google Drive.",
                warning: "Este passo é irreversível! Verifique o preview antes de confirmar.",
            },
            {
                title: "Acompanhamento do lote",
                description: "Após o despacho, acesse a página do lote para ver o status de cada disparo: enviado, com erro, pendente. Erros podem ser reenviados individualmente.",
            },
        ],
        tips: [
            "Use o filtro de período para excluir automaticamente lojas fora do ciclo.",
            "O console do navegador (F12) mostra detalhes de lojas ignoradas e motivos.",
            "Sempre faça o faturamento em ambiente de teste primeiro se possível.",
        ],
    },
    {
        id: "notas-credito",
        title: "Notas de Crédito",
        description: "Emissão de Notas de Crédito (NC) a partir de planilhas — módulo 100% isolado do faturamento principal.",
        icon: <ReceiptText size={22} />,
        color: "#a78bfa",
        steps: [
            {
                title: "Acessar o módulo",
                description: "No menu lateral, clique em \"Notas de Crédito\". Você verá a interface de upload com 4 etapas: Upload, Emissão, Preview e Status.",
            },
            {
                title: "Upload da planilha de NCs",
                description: "Arraste ou selecione um CSV/XLSX contendo as colunas: LOJA, CNPJ, ESTADO, VALOR BOLETO, VALOR NF, VALOR NC. Colunas como Nº NF e DESCONTO são opcionais.",
                tip: "As colunas são detectadas automaticamente — não importa a ordem na planilha. Variações como \"VLR BOLETO\" ou \"VALOR DO BOLETO\" também são aceitas.",
            },
            {
                title: "Revisar e corrigir dados",
                description: "Após o parse, a tabela mostra todos os lançamentos. Clique em qualquer célula para editá-la: loja, CNPJ, estado, valores. Correções são feitas in-place.",
                tip: "Os totalizadores atualizam em tempo real conforme você edita os valores.",
            },
            {
                title: "Definir nome da pasta",
                description: "Digite o nome da pasta no campo \"Nome da Pasta\". Este nome é usado para organizar os arquivos no Google Drive.",
            },
            {
                title: "Emitir Notas de Crédito",
                description: "Clique em \"Emitir NCs\" para disparar os dados para o GCP. Cada loja recebe um disparo individual. O status de cada envio é mostrado na última coluna.",
                warning: "Verifique se o nome da pasta e todos os valores estão corretos antes de emitir. O processo é irreversível.",
            },
        ],
        tips: [
            "Os valores devem estar em formato brasileiro (1.234,56). O parser converte automaticamente.",
            "Campos editáveis são sinalizados com sublinhado tracejado — clique para editar.",
            "Após emitir, a tabela mostra ✅ ou ❌ ao lado de cada loja.",
        ],
    },
    {
        id: "lancamentos-parciais",
        title: "Lançamentos Parciais",
        description: "Processamento de grandes redes (Nordestão/Superfácil) com parser inteligente, matching de lojas e exportação NFE.io/NC.",
        icon: <ClipboardList size={22} />,
        color: "#f472b6",
        steps: [
            {
                title: "Upload da planilha",
                description: "Arraste ou selecione a planilha parcial (CSV/XLSX). O sistema busca automaticamente as colunas: PEDIDO, NOTA (NF/NC), DESCRIÇÃO, VALOR, CNPJ e LOJA.",
                tip: "A coluna \"Nota\" identifica o tipo: \"Nota fiscal\" = NF, \"Nota de crédito\" = NC. Apenas as NFs vão para o XLSX do NFE.io.",
            },
            {
                title: "Matching automático de lojas",
                description: "O sistema cruza os dados com o banco de clientes usando 4 estratégias: CNPJ exato → Nome Conta Azul → Razão Social → Substring parcial. O nome da loja é extraído automaticamente do FINAL da descrição (após a última data).",
                tip: "Use o PRÉ-FILTRO DE EMPRESA (campo com ícone 🏢) para limitar o dropdown \"Vincular\" a uma empresa específica. Isso evita vincular lojas de empresas diferentes por engano.",
            },
            {
                title: "Vincular lojas manualmente",
                description: "Para lojas não encontradas automaticamente, clique em \"Vincular\" na coluna Ação. O dropdown abre PARA CIMA e mostra as lojas filtradas pelo pré-filtro de empresa. Busque por nome, CNPJ ou razão social.",
            },
            {
                title: "Editar campos inline",
                description: "Todos os campos na tabela são editáveis: clique em qualquer valor, pedido, tipo, descrição ou nome da loja para corrigir. Use o dropdown NF/NC para alternar o tipo.",
                tip: "Clique → edite → pressione Enter para confirmar ou Esc para cancelar. Valores monetários são reconvertidos automaticamente.",
            },
            {
                title: "Enriquecimento via XML (opcional)",
                description: "No passo 3, faça upload de um ZIP com os XMLs de retorno. O sistema extrai automaticamente o número da NF gerada e o valor do IRRF, cruzando pelo CNPJ do tomador.",
            },
            {
                title: "Preview e Exportação",
                description: "No passo 4, visualize todos os lançamentos consolidados com os cálculos: Valor Base, NF (11.5%), NC (88.5%) e IRRF. Use o filtro para buscar lançamentos específicos.",
            },
            {
                title: "Exportar NFE.io (.xlsx)",
                description: "Clique em \"Exportar NFE.io\" para gerar o arquivo XLSX com as NFs prontas. Apenas lançamentos do tipo NF com loja identificada são exportados.",
            },
            {
                title: "Emitir NCs via GCP",
                description: "Clique em \"Emitir NC (GCP)\" para disparar as notas de crédito. Os itens são agrupados por loja/CNPJ automaticamente — sem duplicatas. Os números de pedido são enviados no campo correto.",
                warning: "Verifique se todas as lojas estão corretamente vinculadas antes de emitir.",
            },
        ],
        tips: [
            "O pré-filtro de empresa reduz drasticamente a chance de vincular lojas erradas.",
            "A extração do nome da loja prioriza o texto após a última data (dd/mm/yyyy) na descrição.",
            "NCs são agrupadas por loja — se uma loja tem 3 pedidos NC, apenas 1 disparo é feito com o valor total.",
            "Todos os valores nas planilhas exportadas são formatados no padrão contábil brasileiro (1.234,56).",
        ],
    },
];

/* ─── Atalhos do teclado ─── */

const shortcuts = [
    { keys: ["Enter"], description: "Confirma edição de célula" },
    { keys: ["Esc"], description: "Cancela edição de célula" },
    { keys: ["F12"], description: "Abre o console do navegador para logs de debug" },
];

/* ================================================================
   COMPONENTE PRINCIPAL
   ================================================================ */

export default function ComoUsar() {
    const [activeModule, setActiveModule] = useState<string | null>(null);
    const [activeStep, setActiveStep] = useState<Record<string, number>>({});

    const toggleModule = (id: string) => {
        setActiveModule(prev => (prev === id ? null : id));
    };

    const setStepForModule = (moduleId: string, step: number) => {
        setActiveStep(prev => ({ ...prev, [moduleId]: step }));
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 960, margin: "0 auto" }}>

            {/* ── HEADER ── */}
            <div style={{ textAlign: "center", padding: "20px 0 8px" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                    <div style={{
                        width: 48, height: 48, borderRadius: 14,
                        background: "linear-gradient(135deg, #818cf8, #a78bfa)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <BookOpen size={24} color="#fff" />
                    </div>
                    <h1 style={{ fontSize: 28, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.5px" }}>
                        Como Usar
                    </h1>
                </div>
                <p style={{ fontSize: 14, color: "var(--fg-muted)", maxWidth: 520, margin: "0 auto", lineHeight: 1.6 }}>
                    Guia interativo com passo a passo de cada módulo do sistema de faturamento.
                    Clique em um módulo para expandir suas instruções.
                </p>
            </div>

            {/* ── QUICK LINKS ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                {modules.map(mod => (
                    <button
                        key={mod.id}
                        onClick={() => {
                            toggleModule(mod.id);
                            setTimeout(() => {
                                document.getElementById(`guide-${mod.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }, 100);
                        }}
                        style={{
                            display: "flex", alignItems: "center", gap: 10, padding: "14px 16px",
                            borderRadius: 12, border: "1px solid",
                            borderColor: activeModule === mod.id ? mod.color : "var(--border)",
                            background: activeModule === mod.id ? `${mod.color}12` : "var(--bg-card)",
                            color: activeModule === mod.id ? mod.color : "var(--fg)",
                            cursor: "pointer", transition: "all 0.2s", fontSize: 13, fontWeight: 600,
                            textAlign: "left",
                        }}
                    >
                        <span style={{ color: mod.color, flexShrink: 0 }}>{mod.icon}</span>
                        {mod.title}
                    </button>
                ))}
            </div>

            {/* ── MODULES ── */}
            {modules.map(mod => {
                const isOpen = activeModule === mod.id;
                const currentStep = activeStep[mod.id] ?? 0;

                return (
                    <div
                        key={mod.id}
                        id={`guide-${mod.id}`}
                        className="card"
                        style={{
                            padding: 0, overflow: "hidden",
                            borderLeft: `3px solid ${mod.color}`,
                            transition: "all 0.3s",
                        }}
                    >
                        {/* Header */}
                        <button
                            onClick={() => toggleModule(mod.id)}
                            style={{
                                display: "flex", alignItems: "center", justifyContent: "space-between",
                                width: "100%", padding: "18px 22px",
                                background: "transparent", border: "none", cursor: "pointer",
                                color: "#fff", textAlign: "left",
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                <span style={{ color: mod.color }}>{mod.icon}</span>
                                <div>
                                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{mod.title}</h3>
                                    <p style={{ fontSize: 12, color: "var(--fg-muted)", margin: "4px 0 0" }}>{mod.description}</p>
                                </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{
                                    fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
                                    background: `${mod.color}18`, color: mod.color,
                                }}>
                                    {mod.steps.length} passos
                                </span>
                                {isOpen ? <ChevronDown size={18} style={{ color: "var(--fg-dim)" }} /> : <ChevronRight size={18} style={{ color: "var(--fg-dim)" }} />}
                            </div>
                        </button>

                        {/* Content */}
                        {isOpen && (
                            <div style={{ borderTop: "1px solid var(--border)" }}>
                                {/* Step Navigator */}
                                <div style={{
                                    display: "flex", gap: 2, padding: "12px 22px",
                                    background: "rgba(0,0,0,0.15)", overflowX: "auto",
                                }}>
                                    {mod.steps.map((s, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => setStepForModule(mod.id, idx)}
                                            style={{
                                                display: "flex", alignItems: "center", gap: 6,
                                                padding: "6px 12px", borderRadius: 8, border: "none",
                                                background: currentStep === idx ? mod.color : "transparent",
                                                color: currentStep === idx ? "#fff" : "var(--fg-dim)",
                                                fontSize: 12, fontWeight: currentStep === idx ? 700 : 500,
                                                cursor: "pointer", whiteSpace: "nowrap",
                                                transition: "all 0.15s",
                                            }}
                                        >
                                            <span style={{
                                                width: 20, height: 20, borderRadius: "50%",
                                                display: "flex", alignItems: "center", justifyContent: "center",
                                                fontSize: 10, fontWeight: 700,
                                                background: currentStep === idx ? "rgba(255,255,255,0.25)" : "var(--border)",
                                                color: currentStep === idx ? "#fff" : "var(--fg-dim)",
                                            }}>{idx + 1}</span>
                                            {s.title.length > 20 ? s.title.slice(0, 20) + "…" : s.title}
                                        </button>
                                    ))}
                                </div>

                                {/* Active Step Detail */}
                                <div style={{ padding: "24px 28px" }}>
                                    <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                                        <div style={{
                                            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                                            background: `${mod.color}18`, color: mod.color,
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            fontSize: 18, fontWeight: 800,
                                        }}>
                                            {currentStep + 1}
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <h4 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 10px", color: "#fff" }}>
                                                {mod.steps[currentStep].title}
                                            </h4>
                                            <p style={{ fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.7, margin: 0 }}>
                                                {mod.steps[currentStep].description}
                                            </p>

                                            {/* Tip */}
                                            {mod.steps[currentStep].tip && (
                                                <div style={{
                                                    marginTop: 16, padding: "12px 16px", borderRadius: 10,
                                                    background: "rgba(129,140,248,0.06)", border: "1px solid rgba(129,140,248,0.15)",
                                                    display: "flex", alignItems: "flex-start", gap: 10,
                                                }}>
                                                    <Lightbulb size={16} style={{ color: "#818cf8", flexShrink: 0, marginTop: 2 }} />
                                                    <span style={{ fontSize: 13, color: "#a5b4fc", lineHeight: 1.5 }}>
                                                        <strong>Dica:</strong> {mod.steps[currentStep].tip}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Warning */}
                                            {mod.steps[currentStep].warning && (
                                                <div style={{
                                                    marginTop: 12, padding: "12px 16px", borderRadius: 10,
                                                    background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)",
                                                    display: "flex", alignItems: "flex-start", gap: 10,
                                                }}>
                                                    <AlertTriangle size={16} style={{ color: "#f87171", flexShrink: 0, marginTop: 2 }} />
                                                    <span style={{ fontSize: 13, color: "#fca5a5", lineHeight: 1.5 }}>
                                                        <strong>Atenção:</strong> {mod.steps[currentStep].warning}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Step Navigation */}
                                    <div style={{
                                        display: "flex", justifyContent: "space-between", alignItems: "center",
                                        marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border)",
                                    }}>
                                        <button
                                            onClick={() => setStepForModule(mod.id, Math.max(0, currentStep - 1))}
                                            disabled={currentStep === 0}
                                            style={{
                                                padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)",
                                                background: "transparent", color: currentStep === 0 ? "var(--fg-dim)" : "var(--fg)",
                                                cursor: currentStep === 0 ? "not-allowed" : "pointer", fontSize: 13,
                                                opacity: currentStep === 0 ? 0.4 : 1, transition: "all 0.15s",
                                            }}
                                        >
                                            ← Anterior
                                        </button>
                                        <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>
                                            Passo {currentStep + 1} de {mod.steps.length}
                                        </span>
                                        <button
                                            onClick={() => setStepForModule(mod.id, Math.min(mod.steps.length - 1, currentStep + 1))}
                                            disabled={currentStep === mod.steps.length - 1}
                                            style={{
                                                padding: "8px 16px", borderRadius: 8, border: "none",
                                                background: currentStep === mod.steps.length - 1 ? "var(--border)" : mod.color,
                                                color: "#fff", cursor: currentStep === mod.steps.length - 1 ? "not-allowed" : "pointer",
                                                fontSize: 13, fontWeight: 600,
                                                opacity: currentStep === mod.steps.length - 1 ? 0.4 : 1,
                                                transition: "all 0.15s",
                                            }}
                                        >
                                            Próximo →
                                        </button>
                                    </div>
                                </div>

                                {/* Module Tips */}
                                {mod.tips && mod.tips.length > 0 && (
                                    <div style={{
                                        padding: "16px 28px 20px", borderTop: "1px solid var(--border)",
                                        background: "rgba(0,0,0,0.08)",
                                    }}>
                                        <h5 style={{
                                            fontSize: 12, fontWeight: 700, color: "var(--fg-dim)",
                                            textTransform: "uppercase", letterSpacing: "0.5px",
                                            margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6,
                                        }}>
                                            <Zap size={13} /> Dicas Gerais
                                        </h5>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                            {mod.tips.map((t, i) => (
                                                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                                    <CheckCircle2 size={14} style={{ color: mod.color, flexShrink: 0, marginTop: 2 }} />
                                                    <span style={{ fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.5 }}>{t}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* ── ATALHOS DE TECLADO ── */}
            <div className="card" style={{ borderLeft: "3px solid #fbbf24" }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8 }}>
                    <Keyboard size={18} style={{ color: "#fbbf24" }} /> Atalhos Úteis
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
                    {shortcuts.map((sc, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 8, background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.1)" }}>
                            <div style={{ display: "flex", gap: 4 }}>
                                {sc.keys.map((k, j) => (
                                    <kbd key={j} style={{
                                        padding: "3px 8px", borderRadius: 6, fontSize: 12, fontWeight: 700,
                                        background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.2)",
                                        color: "#fbbf24", fontFamily: "monospace",
                                    }}>{k}</kbd>
                                ))}
                            </div>
                            <span style={{ fontSize: 13, color: "var(--fg-muted)" }}>{sc.description}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── FORMATOS ACEITOS ── */}
            <div className="card" style={{ borderLeft: "3px solid #34d399" }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8 }}>
                    <FileSpreadsheet size={18} style={{ color: "#34d399" }} /> Formatos Aceitos
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
                    <FormatCard
                        icon={<FileSpreadsheet size={16} />}
                        title="Planilhas"
                        formats={[".csv", ".xlsx", ".xls"]}
                        color="#34d399"
                    />
                    <FormatCard
                        icon={<FileArchive size={16} />}
                        title="XMLs de retorno"
                        formats={[".zip (contendo .xml)"]}
                        color="#818cf8"
                    />
                    <FormatCard
                        icon={<Info size={16} />}
                        title="Valores monetários"
                        formats={["1.234,56 (BR)", "1234.56 (EN)", "R$ 1.234,56"]}
                        color="#f59e0b"
                    />
                </div>
            </div>

            {/* ── FLUXO VISUAL ── */}
            <div className="card" style={{ borderLeft: "3px solid #818cf8" }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 18px", display: "flex", alignItems: "center", gap: 8 }}>
                    <ArrowRight size={18} style={{ color: "#818cf8" }} /> Fluxo Geral do Faturamento
                </h3>
                <div style={{
                    display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center",
                }}>
                    {[
                        { label: "Upload Planilha", icon: <Upload size={14} />, color: "#818cf8" },
                        { label: "Parse & Validação", icon: <Search size={14} />, color: "#f59e0b" },
                        { label: "Matching Lojas", icon: <Link2 size={14} />, color: "#34d399" },
                        { label: "Preview", icon: <MousePointerClick size={14} />, color: "#a78bfa" },
                        { label: "NFE.io (.xlsx)", icon: <Download size={14} />, color: "#f472b6" },
                        { label: "GCP (NC/Boleto)", icon: <SendHorizonal size={14} />, color: "#f87171" },
                    ].map((item, i, arr) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{
                                display: "flex", alignItems: "center", gap: 6,
                                padding: "10px 16px", borderRadius: 10,
                                background: `${item.color}10`, border: `1px solid ${item.color}30`,
                            }}>
                                <span style={{ color: item.color }}>{item.icon}</span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: item.color }}>{item.label}</span>
                            </div>
                            {i < arr.length - 1 && (
                                <ArrowRight size={14} style={{ color: "var(--fg-dim)" }} />
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

/* ── Sub-componentes ── */

function FormatCard({ icon, title, formats, color }: {
    icon: React.ReactNode; title: string; formats: string[]; color: string;
}) {
    return (
        <div style={{
            padding: "14px 16px", borderRadius: 10,
            background: `${color}06`, border: `1px solid ${color}15`,
            display: "flex", flexDirection: "column", gap: 8,
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color }}>
                {icon}
                <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {formats.map((f, i) => (
                    <span key={i} style={{
                        padding: "3px 10px", borderRadius: 6, fontSize: 12,
                        background: `${color}10`, color,
                        fontFamily: "monospace", fontWeight: 600,
                    }}>{f}</span>
                ))}
            </div>
        </div>
    );
}
