"use client";

/* ================================================================
   COMO USAR — GUIA INTERATIVO DO SISTEMA (v2)
   Atualizado com TODOS os módulos e melhor organização visual
   ================================================================ */

import { useState, useMemo, useRef, useEffect } from "react";
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
    Filter,
    MessageSquare,
    Banknote,
    ShieldCheck,
    UserCircle,
    Package,
    FileText,
    Settings,
    ExternalLink,
    Eye,
    ListPlus,
    PlusCircle,
    Activity,
    CheckCircle,
    SlidersHorizontal,
    Lock,
    Globe,
    ArrowDown,
    Star,
    Hash,
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
    roles: string[];
    group: string;
}

/* ─── Grupos de Módulos ─── */

const GROUPS = [
    { id: "faturamento", label: "Faturamento", icon: <FilePlus size={16} />, color: "#818cf8" },
    { id: "financeiro", label: "Financeiro", icon: <Banknote size={16} />, color: "#34d399" },
    { id: "cadastros", label: "Cadastros", icon: <Users size={16} />, color: "#f59e0b" },
    { id: "sistema", label: "Sistema & Conta", icon: <Settings size={16} />, color: "#a78bfa" },
];

/* ─── Dados dos Módulos ─── */

const modules: ModuleGuide[] = [
    /* ═══════════════════════════════════════════════
       GRUPO: FATURAMENTO
       ═══════════════════════════════════════════════ */
    {
        id: "dashboard",
        title: "Painel Principal",
        description: "Visão estratégica com KPIs, gráficos de ciclo e atalhos rápidos para as operações mais utilizadas.",
        icon: <LayoutDashboard size={22} />,
        color: "#818cf8",
        group: "faturamento",
        roles: ["ADMIN", "APROVADOR", "USER"],
        steps: [
            {
                title: "Visão geral dos KPIs",
                description: "Ao entrar no sistema, o Painel exibe 4 indicadores no topo: Faturamento Total (acumulado histórico), Clientes Ativos, Lotes Pendentes (ainda não consolidados) e Ajustes em Aberto (acréscimos/descontos aguardando aplicação).",
            },
            {
                title: "Gráfico de Faturamento por Ciclo",
                description: "O gráfico de barras à esquerda mostra a distribuição do faturamento agrupado por ciclo de cobrança. Passe o mouse sobre cada barra para ver o valor exato.",
                tip: "Use este gráfico para identificar rapidamente os ciclos com maior receita e planejar ações de cobrança.",
            },
            {
                title: "Ações Rápidas",
                description: "Os cards de ação rápida à direita permitem acesso direto a: Novo Faturamento, Gerenciar Ajustes, Base de Clientes e Gestão de Usuários.",
            },
            {
                title: "Lotes em Processamento",
                description: "A tabela inferior mostra os 5 lotes mais recentes com status, competência e data de criação. Clique em \"Acessar Lote\" para ver os detalhes. Administradores podem excluir lotes diretamente; outros usuários podem solicitar exclusão com justificativa.",
                warning: "Solicitações de exclusão pendentes aparecem em um banner no topo — visível apenas para Administradores.",
            },
        ],
        tips: [
            "Usuários CX são redirecionados automaticamente para o Rastreio de Saques ao acessar o sistema.",
            "O link \"Histórico Completo\" leva à página de todos os lotes processados.",
        ],
    },
    {
        id: "novo-faturamento",
        title: "Novo Faturamento",
        description: "Wizard de 5 etapas: upload da planilha de agendamentos → validação → seleção fiscal → emissão → fechamento.",
        icon: <PlusCircle size={22} />,
        color: "#6366f1",
        group: "faturamento",
        roles: ["ADMIN", "APROVADOR", "USER"],
        steps: [
            {
                title: "Setup Inicial",
                description: "Selecione o(s) ciclo(s) de faturamento, defina o período (data início e fim), nomeie a pasta e faça upload da planilha XLSX com os dados brutos de agendamentos.",
                tip: "Para faturamento cross-mês (ex: Queiroz), ative a opção de \"Data de Corte\" para separar automaticamente os agendamentos entre meses.",
            },
            {
                title: "Resumo do Faturamento",
                description: "O sistema cruza os agendamentos com a base de clientes, gera o resumo financeiro por loja e sinaliza divergências (CNPJ não encontrado, valores zerados). Lojas não reconhecidas podem ser vinculadas manualmente.",
                warning: "Lojas sem correspondência no banco não serão faturadas. Verifique TODOS os itens marcados como divergentes.",
            },
            {
                title: "Seleção Fiscal",
                description: "Selecione quais lojas devem receber NF/NC. Toggle individual ou em massa para incluir/excluir lojas do faturamento. Upload de arquivos NFSe quando necessário.",
            },
            {
                title: "Emissão de Notas",
                description: "Dispare a emissão de notas para as lojas selecionadas. O sistema gera os documentos e envia para o GCP automaticamente.",
                warning: "Este passo pode ser irreversível dependendo da configuração. Sempre revise o preview antes de confirmar.",
            },
            {
                title: "Fechamento do Lote",
                description: "Feche o lote para consolidar os dados. Os ajustes pendentes (acréscimos/descontos) são aplicados automaticamente neste momento. O lote avança para status CONSOLIDADO.",
            },
        ],
        tips: [
            "O wizard salva o progresso na sessão — você pode sair e retornar sem perder dados.",
            "O lote é salvo como RASCUNHO até ser fechado, permitindo edições intermediárias.",
            "Use o console do navegador (F12) para ver logs detalhados de lojas ignoradas e motivos.",
        ],
    },
    {
        id: "lotes",
        title: "Histórico de Lotes",
        description: "Lista completa de todos os lotes de faturamento processados, com status e acesso aos detalhes.",
        icon: <FileText size={22} />,
        color: "#8b5cf6",
        group: "faturamento",
        roles: ["ADMIN", "APROVADOR", "USER"],
        steps: [
            {
                title: "Visualizar lotes",
                description: "A tabela mostra todos os lotes com: data de competência, ciclo (início/fim), data de criação e status. Use a barra de pesquisa para filtrar por ID ou data.",
            },
            {
                title: "Entender os Status",
                description: "ABERTO (azul) → em edição. PENDENTE (amarelo) → aguardando ação. AGUARDANDO_XML (roxo) → fase fiscal. FECHADO (verde) → concluído. ENVIADO (verde) → documentos já despachados.",
            },
            {
                title: "Acessar detalhes do lote",
                description: "Clique em um lote para abrir a tela de consolidação: tabela por loja com valores base, acréscimos, descontos, boleto final, NF e NC. Cada loja tem toggle para inclusão/exclusão.",
                tip: "Passe o mouse sobre os valores de ajuste para ver detalhes individuais (motivo, profissional, valor).",
            },
        ],
        tips: [
            "Lotes com solicitação de exclusão pendente exibem um indicador amarelo.",
            "Administradores podem excluir lotes diretamente; outros cargos devem solicitar exclusão.",
        ],
    },
    {
        id: "triagem",
        title: "Triagem",
        description: "Upload, validação e disparo de boletos (PDF) e pacotes de NFs (ZIP) para os clientes.",
        icon: <Filter size={22} />,
        color: "#06b6d4",
        group: "faturamento",
        roles: ["ADMIN", "APROVADOR", "USER"],
        steps: [
            {
                title: "Upload de documentos",
                description: "Faça upload de boletos individuais em PDF ou pacotes de NFs compactados em ZIP. O sistema aceita múltiplos arquivos simultaneamente.",
            },
            {
                title: "Validação automática",
                description: "Cada arquivo passa por matching automático: identificação do cliente, extração do número da NF/NC e cálculo de confiança do match. Arquivos com status de erro são sinalizados para revisão.",
                tip: "Verifique o índice de confiança (matchConfidence) — valores baixos indicam que a identificação pode estar errada.",
            },
            {
                title: "Disparo para clientes",
                description: "Após validar, dispare os documentos para os clientes correspondentes. O status de cada envio é rastreado individualmente.",
                warning: "Certifique-se de que todos os matches estão corretos antes de disparar. Documentos enviados ao cliente errado podem causar problemas.",
            },
        ],
        tips: [
            "Boletos devem ser PDFs individuais com nome descritivo para facilitar o matching.",
            "ZIPs devem conter apenas os XMLs/PDFs de NFs relacionados ao mesmo lote.",
        ],
    },
    {
        id: "lancamentos-parciais",
        title: "Lançamentos Parciais",
        description: "Processamento de grandes redes com parser inteligente, matching de lojas e exportação NFE.io/NC.",
        icon: <ListPlus size={22} />,
        color: "#f472b6",
        group: "faturamento",
        roles: ["ADMIN", "APROVADOR", "USER"],
        steps: [
            {
                title: "Upload da planilha",
                description: "Arraste ou selecione a planilha parcial (CSV/XLSX). O sistema detecta automaticamente as colunas: PEDIDO, NOTA (NF/NC), DESCRIÇÃO, VALOR, CNPJ e LOJA.",
                tip: "A coluna \"Nota\" identifica o tipo: \"Nota fiscal\" = NF, \"Nota de crédito\" = NC. Apenas as NFs vão para o XLSX do NFE.io.",
            },
            {
                title: "Matching automático de lojas",
                description: "O sistema cruza os dados com o banco de clientes usando 4 estratégias: CNPJ exato → Nome Conta Azul → Razão Social → Substring parcial. O nome da loja é extraído automaticamente do final da descrição (após a última data).",
                tip: "Use o PRÉ-FILTRO DE EMPRESA (campo com ícone 🏢) para limitar o dropdown \"Vincular\" a uma empresa específica. Isso evita vincular lojas de empresas diferentes por engano.",
            },
            {
                title: "Vincular lojas manualmente",
                description: "Para lojas não encontradas, clique em \"Vincular\" na coluna Ação. O dropdown mostra as lojas filtradas pelo pré-filtro de empresa. Busque por nome, CNPJ ou razão social.",
            },
            {
                title: "Editar campos inline",
                description: "Todos os campos na tabela são editáveis: clique em qualquer valor, pedido, tipo, descrição ou nome. Use o dropdown NF/NC para alternar o tipo.",
                tip: "Clique → edite → pressione Enter para confirmar ou Esc para cancelar. Valores monetários são reconvertidos automaticamente.",
            },
            {
                title: "Enriquecimento via XML (opcional)",
                description: "Faça upload de um ZIP com os XMLs de retorno. O sistema extrai automaticamente o número da NF gerada e o valor do IRRF, cruzando pelo CNPJ do tomador.",
            },
            {
                title: "Preview e Exportação",
                description: "Visualize todos os lançamentos consolidados com os cálculos: Valor Base, NF, NC e IRRF. Exporte para NFE.io (.xlsx) ou emita NCs via GCP.",
                warning: "Verifique se todas as lojas estão corretamente vinculadas antes de emitir NCs.",
            },
        ],
        tips: [
            "O pré-filtro de empresa reduz drasticamente a chance de vincular lojas erradas.",
            "A extração do nome da loja prioriza o texto após a última data (dd/mm/yyyy) na descrição.",
            "NCs são agrupadas por loja — se uma loja tem 3 pedidos NC, apenas 1 disparo é feito com o valor total.",
            "Todos os valores nas planilhas exportadas são formatados no padrão contábil brasileiro (1.234,56).",
        ],
    },
    {
        id: "notas-credito",
        title: "Notas de Crédito",
        description: "Emissão de NCs em lote a partir de planilha — módulo isolado do faturamento principal.",
        icon: <ReceiptText size={22} />,
        color: "#a78bfa",
        group: "faturamento",
        roles: ["ADMIN", "APROVADOR", "USER"],
        steps: [
            {
                title: "Upload da planilha de NCs",
                description: "Arraste ou selecione um CSV/XLSX contendo: LOJA, CNPJ, ESTADO, VALOR BOLETO, VALOR NF, VALOR NC. Colunas como Nº NF e DESCONTO são opcionais.",
                tip: "As colunas são detectadas automaticamente — não importa a ordem na planilha. Variações como \"VLR BOLETO\" também são aceitas.",
            },
            {
                title: "Revisar e corrigir dados",
                description: "A tabela mostra todos os lançamentos com edição in-place: clique em qualquer célula para ajustar loja, CNPJ, estado ou valores. Os totalizadores atualizam em tempo real.",
            },
            {
                title: "Definir nome da pasta",
                description: "Digite o nome da pasta no campo correspondente. Este nome é usado para organizar os arquivos no Google Drive.",
            },
            {
                title: "Emitir Notas de Crédito",
                description: "Clique em \"Emitir NCs\" para disparar os dados para o GCP. Cada loja recebe um disparo individual. O status (✅ ou ❌) é exibido ao lado de cada loja.",
                warning: "Verifique se o nome da pasta e todos os valores estão corretos. O processo é irreversível.",
            },
        ],
        tips: [
            "Valores devem estar em formato brasileiro (1.234,56). O parser converte automaticamente.",
            "Campos editáveis são sinalizados com sublinhado tracejado — clique para editar.",
        ],
    },
    {
        id: "disparos",
        title: "Central de Disparos",
        description: "Envio em massa de notificações via WhatsApp (Evolution API) com templates, variáveis dinâmicas e rastreio em tempo real.",
        icon: <MessageSquare size={22} />,
        color: "#22c55e",
        group: "faturamento",
        roles: ["ADMIN", "APROVADOR"],
        steps: [
            {
                title: "Painel de Seleção",
                description: "Selecione os destinatários de 3 formas: (1) Vincular a um lote de faturamento existente, (2) Upload de planilha XLSX com colunas CNPJ e Telefone, ou (3) Buscar contatos individualmente na base de dados.",
                tip: "É possível combinar as 3 fontes — contatos são mesclados e deduplicados automaticamente.",
            },
            {
                title: "Processar contatos",
                description: "Clique em \"Processar Contatos\" para enriquecer os dados: o sistema cruza CNPJ com a base de clientes, busca nome fantasia, razão social e valores do lote. Contatos sem telefone ou CNPJ inválido são movidos para \"Ignorados\".",
            },
            {
                title: "Estúdio de Mensagem",
                description: "Escreva a mensagem ou selecione um template salvo. Insira variáveis dinâmicas clicando nos botões: {{nome_fantasia}}, {{razao_social}}, {{primeiro_nome}}, {{valor_total}}, {{vencimento}}, {{nome_lote}}.",
                tip: "O preview WhatsApp à direita atualiza em tempo real, substituindo as variáveis com dados do primeiro destinatário.",
            },
            {
                title: "Review e Disparo",
                description: "Revise o total de destinatários e ignorados. Confirme o envio. O progresso é mostrado em tempo real via SSE (streaming). Use os botões de Pausar ou Cancelar durante o envio.",
                warning: "Confirme que a mensagem e os destinatários estão corretos antes de disparar. O envio processa cada contato individualmente.",
            },
        ],
        tips: [
            "O log de envio mostra o status individual de cada mensagem: enviada, erro ou pulada.",
            "Use templates para padronizar mensagens recorrentes e evitar erros de digitação.",
            "A busca na base aceita razão social, nome fantasia ou CNPJ.",
        ],
    },
    {
        id: "logs-envio",
        title: "Logs de E-mail",
        description: "Auditoria de e-mails enviados — rastreie entregas, falhas e reenvios de cada lote.",
        icon: <Eye size={22} />,
        color: "#64748b",
        group: "faturamento",
        roles: ["ADMIN", "APROVADOR", "USER"],
        steps: [
            {
                title: "Consultar logs",
                description: "Acesse via Faturamento → Logs de Envio. A tabela mostra: Data/Hora, Cliente, Assunto, Destinatários, Status (Sucesso ou Erro). Busque por nome do cliente, assunto ou destinatário.",
            },
            {
                title: "Reenviar e-mails",
                description: "E-mails com falha podem ser reenviados individualmente ou em lote. Personalize o assunto antes de reenviar usando variáveis: {Loja}, {Período faturado}, {Ciclo}.",
                warning: "Ao reenviar, os logs de erro anteriores são limpos e apenas os clientes listados como \"não enviados\" são processados.",
            },
        ],
    },

    /* ═══════════════════════════════════════════════
       GRUPO: FINANCEIRO
       ═══════════════════════════════════════════════ */
    {
        id: "saques",
        title: "Gestão de Saques",
        description: "Importe, valide e exporte lotes de pagamento via PIX para o gateway Transfeera.",
        icon: <Banknote size={22} />,
        color: "#10b981",
        group: "financeiro",
        roles: ["ADMIN", "APROVADOR", "USER"],
        steps: [
            {
                title: "Importar planilha de saques",
                description: "Faça upload de um XLSX/CSV com os dados de pagamento: chaves PIX, CPF/CNPJ, valores e beneficiários. O parser valida automaticamente cada chave PIX e documento.",
            },
            {
                title: "Validação dos dados",
                description: "O sistema verifica: formato da chave PIX (CPF, CNPJ, E-mail, Telefone, Aleatória), validade dos documentos e matching com a base de clientes. Itens com erro são sinalizados.",
                warning: "Chaves PIX inválidas ou documentos com formato incorreto são bloqueados automaticamente para evitar erros no pagamento.",
            },
            {
                title: "Criar lote de saque",
                description: "Nomeie o lote, defina o tipo de saque e confirme. O lote é criado com status AGUARDANDO_APROVAÇÃO e encaminhado para a fila de aprovações.",
            },
            {
                title: "Histórico de lotes",
                description: "A seção inferior mostra todos os lotes processados com valor total, quantidade de itens, status e data de criação.",
            },
        ],
        tips: [
            "A planilha deve conter colunas identificáveis de chave PIX e valor.",
            "Itens com tipo PIX inválido são automaticamente marcados como BLOQUEADO.",
        ],
    },
    {
        id: "saques-aprovacoes",
        title: "Aprovação de Saques",
        description: "Analise e autorize o envio de lotes para processamento na Transfeera.",
        icon: <CheckCircle size={22} />,
        color: "#0ea5e9",
        group: "financeiro",
        roles: ["ADMIN", "APROVADOR"],
        steps: [
            {
                title: "Revisar lotes pendentes",
                description: "A tela mostra cards de cada lote aguardando aprovação: nome, tipo de saque, quantidade de itens, custo total e data de criação.",
            },
            {
                title: "Revisar detalhes",
                description: "Clique em \"Revisar Lote\" para ver todos os itens individualmente: beneficiário, chave PIX, valor e status de validação. Verifique cada item antes de aprovar.",
            },
            {
                title: "Aprovar ou Rejeitar",
                description: "Aprovar inicia imediatamente o processamento financeiro na Transfeera. Rejeitar exclui permanentemente o lote e todos os seus itens (CASCADE).",
                warning: "Antes de aprovar, certifique-se de que há saldo suficiente na conta bancária vinculada à Transfeera!",
            },
        ],
        tips: [
            "O total pendente é exibido no cabeçalho para referência rápida.",
            "Lotes rejeitados são excluídos permanentemente e não podem ser recuperados.",
        ],
    },
    {
        id: "saques-rastreio",
        title: "Rastreio de Saques",
        description: "Acompanhamento do status de pagamentos processados pela Transfeera.",
        icon: <Activity size={22} />,
        color: "#14b8a6",
        group: "financeiro",
        roles: ["ADMIN", "APROVADOR", "USER", "CX"],
        steps: [
            {
                title: "Dashboard de status",
                description: "Visualize todos os lotes enviados com status em tempo real: processando, concluído, com erro. Cada item individual pode ser rastreado.",
                tip: "Esta é a única página acessível pelo cargo CX (Customer Experience), que é redirecionado automaticamente para cá ao fazer login.",
            },
            {
                title: "Filtrar e buscar",
                description: "Use os filtros para localizar pagamentos específicos por beneficiário, valor, data ou status.",
            },
        ],
    },
    {
        id: "ajustes",
        title: "Ajustes",
        description: "Central de acréscimos, descontos e aprovação de solicitações de ônus — o maior módulo do sistema.",
        icon: <SlidersHorizontal size={22} />,
        color: "#f59e0b",
        group: "financeiro",
        roles: ["ADMIN", "APROVADOR", "USER"],
        steps: [
            {
                title: "Aba Gestão — Descontos",
                description: "Lista os descontos pendentes (ainda não aplicados a nenhum lote). Crie novos descontos clicando em \"Novo Desconto\": selecione o cliente, informe valor, profissional, motivo, data e canal de recebimento (Tasky/E-mail/WhatsApp).",
            },
            {
                title: "Aba Gestão — Acréscimos",
                description: "Mesma lógica dos descontos, porém para valores a serem adicionados ao faturamento. Importação em lote via XLSX/CSV também disponível.",
                tip: "Use a importação em lote para carregar dezenas de ajustes de uma vez a partir de planilha formatada.",
            },
            {
                title: "Aba Gestão — Histórico",
                description: "Ajustes já aplicados a algum lote. Filtre por período (ocorrência ou aplicação), cliente, termo de busca. Exporte tudo para XLSX.",
            },
            {
                title: "Aba Aprovações (Ônus)",
                description: "Solicitações vindas do Formulário de Ônus externo. Filtro por status (Pendente/Aprovado/Recusado). Abra uma solicitação para revisar: edite tipo, cliente, valor e observação. Aprovar gera automaticamente um ajuste; Recusar exige motivo.",
                warning: "Solicitações pendentes possuem um badge com contagem na aba — não deixe acumular!",
            },
            {
                title: "Aba Relatórios",
                description: "Dashboard analítico de ajustes: filtre por período, canal e status. Visualize totais agrupados por loja com detalhes por profissional. Exporte para XLSX ou gere relatórios em PDF (individual por loja ou ZIP com todos).",
            },
        ],
        tips: [
            "Ajustes pendentes são aplicados automaticamente ao fechar um lote de faturamento.",
            "O campo \"Repasse Profissional\" sinaliza se o ajuste deve ser cobrado do profissional.",
            "Seleção múltipla (checkboxes) permite exportar apenas os itens selecionados.",
            "O campo \"Observação Interna\" é visível apenas para a equipe — não aparece em relatórios para o cliente.",
        ],
    },

    /* ═══════════════════════════════════════════════
       GRUPO: CADASTROS
       ═══════════════════════════════════════════════ */
    {
        id: "clientes",
        title: "Clientes",
        description: "Cadastro completo de empresas, dados fiscais, e-mails de contato, ciclos e produtos.",
        icon: <Building2 size={22} />,
        color: "#f97316",
        group: "cadastros",
        roles: ["ADMIN", "APROVADOR", "USER"],
        steps: [
            {
                title: "Listar e buscar clientes",
                description: "A tabela mostra todos os clientes com razão social, nome fantasia, nome Conta Azul, CNPJ, ciclo de faturamento, produto e status. Use a barra de pesquisa para filtrar.",
            },
            {
                title: "Cadastrar novo cliente",
                description: "Clique em \"Novo Cliente\" e preencha: razão social, nome fantasia, CNPJ, nome Conta Azul, endereço completo (incluindo código IBGE), ciclo de faturamento e produto.",
                tip: "O campo \"Nome Conta Azul\" é essencial para o matching automático no faturamento. Mantenha-o atualizado!",
            },
            {
                title: "Editar e gerenciar e-mails",
                description: "Clique no cliente para editar todos os campos. Na aba de contatos, gerencie os e-mails que receberão os documentos fiscais.",
                warning: "Alterações no CNPJ podem afetar o matching automático em Lançamentos Parciais e Faturamento.",
            },
            {
                title: "Ativar / Desativar",
                description: "Clientes desativados não aparecem no faturamento nem nos selects de outros módulos. Use o toggle de status para controlar sem excluir o cadastro.",
            },
        ],
        tips: [
            "Mantenha o código IBGE atualizado — é obrigatório para exportação NFE.io.",
            "Importe clientes em lote para evitar cadastro manual um a um.",
            "O ciclo de faturamento determina em qual lote o cliente será incluído automaticamente.",
        ],
    },
    {
        id: "produtos",
        title: "Produtos Faturamento",
        description: "Gerencie os produtos e porcentagens NF/NC aplicadas no cálculo de faturamento.",
        icon: <Package size={22} />,
        color: "#ec4899",
        group: "cadastros",
        roles: ["ADMIN"],
        steps: [
            {
                title: "Visualizar produtos",
                description: "A tabela lista todos os produtos cadastrados com: nome, % NF, % NC (calculada automaticamente como 100 - %NF) e data de atualização. Os KPIs no topo mostram total, menor e maior % NF.",
            },
            {
                title: "Criar / Editar produto",
                description: "Clique em \"Novo Produto\" ou clique em um produto existente. Defina o nome e a porcentagem de NF. O preview mostra a distribuição entre NF e NC em tempo real.",
                tip: "O padrão é 11,5% para NF e 88,5% para NC. Ajuste conforme o contrato de cada produto.",
            },
            {
                title: "Excluir produto",
                description: "Ao excluir um produto, clientes vinculados terão o campo esvaziado e retornarão ao percentual padrão (11,5%).",
                warning: "Esta ação não pode ser desfeita. Verifique se há clientes vinculados antes de excluir.",
            },
        ],
    },

    /* ═══════════════════════════════════════════════
       GRUPO: SISTEMA & CONTA
       ═══════════════════════════════════════════════ */
    {
        id: "usuarios",
        title: "Usuários",
        description: "Controle de acessos: crie, edite cargos e gerencie credenciais dos operadores do sistema.",
        icon: <Users size={22} />,
        color: "#6366f1",
        group: "sistema",
        roles: ["ADMIN", "APROVADOR"],
        steps: [
            {
                title: "Listar usuários",
                description: "A tabela mostra todos os usuários com nome, e-mail, cargo e status. KPIs no topo: Total de usuários, Admins e Ativos. Use a busca por nome ou e-mail.",
            },
            {
                title: "Criar novo usuário",
                description: "Preencha: nome, e-mail, senha inicial e selecione o cargo. O usuário receberá acesso de acordo com o cargo atribuído.",
            },
            {
                title: "Entender os cargos",
                description: "USER → acesso básico ao faturamento. CX → foco em atendimento e rastreio de saques. APROVADOR → pode autorizar lotes de pagamento e disparos. ADMIN → acesso total ao sistema, incluindo exclusão de lotes e gestão de usuários.",
            },
            {
                title: "Alterar cargo e recuperar senha",
                description: "Clique no usuário para alterar o cargo via modal. Use \"Enviar recuperação de senha\" para que o usuário redefina sua senha por e-mail.",
                warning: "Ao alterar o cargo de um usuário, as permissões mudam imediatamente no próximo acesso.",
            },
        ],
    },
    {
        id: "perfil",
        title: "Meu Perfil",
        description: "Gerencie seus dados pessoais, e-mail e senha de acesso.",
        icon: <UserCircle size={22} />,
        color: "#8b5cf6",
        group: "sistema",
        roles: ["ADMIN", "APROVADOR", "USER", "CX"],
        steps: [
            {
                title: "Dados Cadastrais",
                description: "Atualize seu nome de exibição. A alteração é sincronizada com o perfil interno e os metadados de autenticação.",
            },
            {
                title: "Alterar E-mail",
                description: "Informe o novo endereço de e-mail. Será necessário confirmar tanto no e-mail antigo quanto no novo para completar a alteração.",
                warning: "A alteração de e-mail exige confirmação dupla (antigo + novo) por segurança.",
            },
            {
                title: "Alterar Senha",
                description: "Digite a nova senha e confirme. A senha é atualizada imediatamente após confirmação.",
                tip: "Para alterações de cargo, entre em contato com um Administrador — não é possível alterar o próprio cargo.",
            },
        ],
    },
    {
        id: "formulario-onus",
        title: "Formulário de Ônus",
        description: "Formulário externo (sem login) para registro de cobranças e ônus por profissionais. As solicitações chegam na aba Aprovações dos Ajustes.",
        icon: <Globe size={22} />,
        color: "#ef4444",
        group: "sistema",
        roles: ["ADMIN", "APROVADOR", "USER"],
        steps: [
            {
                title: "Identificação da Loja",
                description: "O profissional digita o CNPJ e o sistema busca automaticamente a loja na base. Se encontrada, o nome é preenchido automaticamente. Caso contrário, o nome pode ser digitado manualmente.",
            },
            {
                title: "Dados do Ônus",
                description: "Preencha: nome do usuário, data do agendamento, descrição detalhada e valor (com máscara BRL). Todos os campos são obrigatórios.",
            },
            {
                title: "Anexo (opcional)",
                description: "Upload de termo assinado ou comprovante (PDF/PNG/JPG, até 10MB) via drag & drop ou clique.",
            },
            {
                title: "Contato e Envio",
                description: "E-mail de retorno opcional para confirmação. Ao enviar, a solicitação aparece em Ajustes → Aprovações com status 'pendente' para revisão do admin.",
                tip: "O formulário é responsivo: no mobile, funciona como stepper (passo a passo); no desktop, exibe todos os campos em uma página.",
            },
        ],
        tips: [
            "O formulário não exige login — é acessível por link público.",
            "Solicitações enviadas aparecem automaticamente na aba Aprovações do módulo Ajustes.",
            "O canal é registrado como \"formulário\" para diferenciação nos relatórios.",
        ],
    },
];

/* ─── Atalhos do teclado ─── */

const shortcuts = [
    { keys: ["Enter"], description: "Confirma edição de célula" },
    { keys: ["Esc"], description: "Cancela edição de célula" },
    { keys: ["F12"], description: "Abre o console do navegador para logs de debug" },
    { keys: ["Ctrl", "F"], description: "Busca no navegador (útil em tabelas grandes)" },
];

/* ─── Fluxos do Sistema ─── */

const WORKFLOWS = [
    {
        title: "Fluxo de Faturamento",
        color: "#818cf8",
        steps: [
            { label: "Upload XLSX", icon: <Upload size={13} /> },
            { label: "Validação", icon: <Search size={13} /> },
            { label: "Matching", icon: <Link2 size={13} /> },
            { label: "Fiscal", icon: <FileText size={13} /> },
            { label: "Emissão", icon: <SendHorizonal size={13} /> },
            { label: "Fechamento", icon: <CheckCircle2 size={13} /> },
        ],
    },
    {
        title: "Fluxo de Saques",
        color: "#10b981",
        steps: [
            { label: "Importar PIX", icon: <Upload size={13} /> },
            { label: "Validar", icon: <ShieldCheck size={13} /> },
            { label: "Criar Lote", icon: <Package size={13} /> },
            { label: "Aprovar", icon: <CheckCircle size={13} /> },
            { label: "Transfeera", icon: <SendHorizonal size={13} /> },
            { label: "Rastreio", icon: <Activity size={13} /> },
        ],
    },
    {
        title: "Fluxo de Ajustes",
        color: "#f59e0b",
        steps: [
            { label: "Formulário / Manual", icon: <Globe size={13} /> },
            { label: "Aprovação Admin", icon: <ShieldCheck size={13} /> },
            { label: "Ajuste Criado", icon: <SlidersHorizontal size={13} /> },
            { label: "Aplicado no Lote", icon: <CheckCircle2 size={13} /> },
        ],
    },
];

/* ================================================================
   COMPONENTE PRINCIPAL
   ================================================================ */

export default function ComoUsar() {
    const [activeModule, setActiveModule] = useState<string | null>(null);
    const [activeStep, setActiveStep] = useState<Record<string, number>>({});
    const [searchTerm, setSearchTerm] = useState("");
    const [activeGroup, setActiveGroup] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    /* ─── Filtro ─── */
    const filteredModules = useMemo(() => {
        let result = modules;

        if (activeGroup) {
            result = result.filter(m => m.group === activeGroup);
        }

        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            result = result.filter(
                m =>
                    m.title.toLowerCase().includes(q) ||
                    m.description.toLowerCase().includes(q) ||
                    m.steps.some(s => s.title.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) ||
                    (m.tips || []).some(t => t.toLowerCase().includes(q))
            );
        }

        return result;
    }, [activeGroup, searchTerm]);

    const toggleModule = (id: string) => {
        setActiveModule(prev => (prev === id ? null : id));
    };

    const setStepForModule = (moduleId: string, step: number) => {
        setActiveStep(prev => ({ ...prev, [moduleId]: step }));
    };

    /* ─── Badge de Cargo ─── */
    const RoleBadge = ({ role }: { role: string }) => {
        const colors: Record<string, { bg: string; text: string }> = {
            ADMIN: { bg: "rgba(239,68,68,0.10)", text: "#ef4444" },
            APROVADOR: { bg: "rgba(245,158,11,0.10)", text: "#f59e0b" },
            USER: { bg: "rgba(99,102,241,0.10)", text: "#818cf8" },
            CX: { bg: "rgba(20,184,166,0.10)", text: "#14b8a6" },
        };
        const c = colors[role] || colors.USER;
        return (
            <span style={{
                fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 6,
                background: c.bg, color: c.text, letterSpacing: "0.5px", textTransform: "uppercase",
            }}>{role}</span>
        );
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 1020, margin: "0 auto" }}>

            {/* ══════════ HEADER ══════════ */}
            <div style={{ textAlign: "center", padding: "24px 0 4px" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                    <div style={{
                        width: 52, height: 52, borderRadius: 16,
                        background: "linear-gradient(135deg, #818cf8, #6366f1)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 8px 24px rgba(99,102,241,0.25)",
                    }}>
                        <BookOpen size={26} color="#fff" />
                    </div>
                    <div style={{ textAlign: "left" }}>
                        <h1 style={{ fontSize: 30, fontWeight: 900, color: "#fff", margin: 0, letterSpacing: "-0.5px" }}>
                            Manual de Uso
                        </h1>
                        <p style={{ fontSize: 12, color: "var(--fg-dim)", margin: "2px 0 0", fontWeight: 600, letterSpacing: "0.3px" }}>
                            v2.0 — Atualizado em Junho 2026
                        </p>
                    </div>
                </div>
                <p style={{ fontSize: 14, color: "var(--fg-muted)", maxWidth: 580, margin: "0 auto", lineHeight: 1.7 }}>
                    Guia completo e interativo de todos os <strong style={{ color: "var(--fg)" }}>{modules.length} módulos</strong> do sistema.
                    Use a busca ou os filtros por grupo para encontrar rapidamente o que precisa.
                </p>
            </div>

            {/* ══════════ SEARCH BAR ══════════ */}
            <div style={{
                position: "relative", maxWidth: 520, margin: "0 auto", width: "100%",
            }}>
                <Search size={16} style={{
                    position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                    color: "var(--fg-dim)", pointerEvents: "none",
                }} />
                <input
                    ref={searchRef}
                    type="text"
                    placeholder="Buscar por módulo, funcionalidade ou palavra-chave..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    style={{
                        width: "100%", padding: "12px 14px 12px 40px", borderRadius: 14,
                        border: "1px solid var(--border)", background: "var(--bg-card)",
                        color: "var(--fg)", fontSize: 14, outline: "none",
                        transition: "border-color 0.2s",
                    }}
                    onFocus={e => (e.target.style.borderColor = "#818cf8")}
                    onBlur={e => (e.target.style.borderColor = "var(--border)")}
                />
                {searchTerm && (
                    <button
                        onClick={() => { setSearchTerm(""); searchRef.current?.focus(); }}
                        style={{
                            position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                            background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8,
                            padding: "4px 8px", cursor: "pointer", color: "var(--fg-dim)", fontSize: 11,
                        }}
                    >✕ Limpar</button>
                )}
            </div>

            {/* ══════════ GROUP TABS ══════════ */}
            <div style={{
                display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap",
            }}>
                <button
                    onClick={() => setActiveGroup(null)}
                    style={{
                        display: "flex", alignItems: "center", gap: 6, padding: "8px 16px",
                        borderRadius: 10, border: "1px solid",
                        borderColor: !activeGroup ? "#818cf8" : "var(--border)",
                        background: !activeGroup ? "rgba(129,140,248,0.12)" : "var(--bg-card)",
                        color: !activeGroup ? "#818cf8" : "var(--fg-muted)",
                        cursor: "pointer", fontSize: 13, fontWeight: 700,
                        transition: "all 0.2s",
                    }}
                >
                    <Star size={14} /> Todos ({modules.length})
                </button>
                {GROUPS.map(g => {
                    const count = modules.filter(m => m.group === g.id).length;
                    const isActive = activeGroup === g.id;
                    return (
                        <button
                            key={g.id}
                            onClick={() => setActiveGroup(isActive ? null : g.id)}
                            style={{
                                display: "flex", alignItems: "center", gap: 6, padding: "8px 16px",
                                borderRadius: 10, border: "1px solid",
                                borderColor: isActive ? g.color : "var(--border)",
                                background: isActive ? `${g.color}15` : "var(--bg-card)",
                                color: isActive ? g.color : "var(--fg-muted)",
                                cursor: "pointer", fontSize: 13, fontWeight: 700,
                                transition: "all 0.2s",
                            }}
                        >
                            {g.icon} {g.label} ({count})
                        </button>
                    );
                })}
            </div>

            {/* ══════════ RESULTS COUNT ══════════ */}
            {(searchTerm || activeGroup) && (
                <div style={{
                    fontSize: 12, color: "var(--fg-dim)", textAlign: "center",
                    fontWeight: 600, letterSpacing: "0.3px",
                }}>
                    {filteredModules.length === 0
                        ? "Nenhum módulo encontrado com os filtros atuais."
                        : `Exibindo ${filteredModules.length} de ${modules.length} módulos`}
                </div>
            )}

            {/* ══════════ MODULE CARDS ══════════ */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {filteredModules.map(mod => {
                    const isOpen = activeModule === mod.id;
                    const currentStep = activeStep[mod.id] ?? 0;
                    const groupInfo = GROUPS.find(g => g.id === mod.group);

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
                            {/* Module Header */}
                            <button
                                onClick={() => toggleModule(mod.id)}
                                style={{
                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                    width: "100%", padding: "16px 20px",
                                    background: "transparent", border: "none", cursor: "pointer",
                                    color: "#fff", textAlign: "left",
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                    <div style={{
                                        width: 40, height: 40, borderRadius: 12,
                                        background: `${mod.color}15`, color: mod.color,
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        flexShrink: 0,
                                    }}>{mod.icon}</div>
                                    <div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{mod.title}</h3>
                                            <div style={{ display: "flex", gap: 3 }}>
                                                {mod.roles.map(r => <RoleBadge key={r} role={r} />)}
                                            </div>
                                        </div>
                                        <p style={{ fontSize: 12, color: "var(--fg-muted)", margin: "3px 0 0", lineHeight: 1.5 }}>
                                            {mod.description}
                                        </p>
                                    </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: 12 }}>
                                    <span style={{
                                        fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 20,
                                        background: `${mod.color}15`, color: mod.color,
                                    }}>
                                        {mod.steps.length} {mod.steps.length === 1 ? "passo" : "passos"}
                                    </span>
                                    <div style={{
                                        transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                                    }}>
                                        <ChevronDown size={16} style={{ color: "var(--fg-dim)" }} />
                                    </div>
                                </div>
                            </button>

                            {/* Module Content (Expandable) */}
                            {isOpen && (
                                <div style={{ borderTop: "1px solid var(--border)" }}>
                                    {/* Step Pills */}
                                    <div style={{
                                        display: "flex", gap: 4, padding: "10px 20px",
                                        background: "rgba(0,0,0,0.12)", overflowX: "auto",
                                    }}>
                                        {mod.steps.map((s, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => setStepForModule(mod.id, idx)}
                                                style={{
                                                    display: "flex", alignItems: "center", gap: 6,
                                                    padding: "5px 12px", borderRadius: 8, border: "none",
                                                    background: currentStep === idx ? mod.color : "transparent",
                                                    color: currentStep === idx ? "#fff" : "var(--fg-dim)",
                                                    fontSize: 11, fontWeight: currentStep === idx ? 700 : 500,
                                                    cursor: "pointer", whiteSpace: "nowrap",
                                                    transition: "all 0.15s",
                                                }}
                                            >
                                                <span style={{
                                                    width: 18, height: 18, borderRadius: "50%",
                                                    display: "flex", alignItems: "center", justifyContent: "center",
                                                    fontSize: 9, fontWeight: 800,
                                                    background: currentStep === idx ? "rgba(255,255,255,0.25)" : "var(--border)",
                                                    color: currentStep === idx ? "#fff" : "var(--fg-dim)",
                                                }}>{idx + 1}</span>
                                                {s.title.length > 22 ? s.title.slice(0, 22) + "…" : s.title}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Active Step Detail */}
                                    <div style={{ padding: "22px 24px" }}>
                                        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                                            <div style={{
                                                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                                                background: `${mod.color}15`, color: mod.color,
                                                display: "flex", alignItems: "center", justifyContent: "center",
                                                fontSize: 16, fontWeight: 800,
                                            }}>
                                                {currentStep + 1}
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <h4 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px", color: "#fff" }}>
                                                    {mod.steps[currentStep].title}
                                                </h4>
                                                <p style={{ fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.7, margin: 0 }}>
                                                    {mod.steps[currentStep].description}
                                                </p>

                                                {/* Tip */}
                                                {mod.steps[currentStep].tip && (
                                                    <div style={{
                                                        marginTop: 14, padding: "10px 14px", borderRadius: 10,
                                                        background: "rgba(129,140,248,0.06)", border: "1px solid rgba(129,140,248,0.15)",
                                                        display: "flex", alignItems: "flex-start", gap: 10,
                                                    }}>
                                                        <Lightbulb size={15} style={{ color: "#818cf8", flexShrink: 0, marginTop: 1 }} />
                                                        <span style={{ fontSize: 12, color: "#a5b4fc", lineHeight: 1.5 }}>
                                                            <strong>Dica:</strong> {mod.steps[currentStep].tip}
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Warning */}
                                                {mod.steps[currentStep].warning && (
                                                    <div style={{
                                                        marginTop: 10, padding: "10px 14px", borderRadius: 10,
                                                        background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)",
                                                        display: "flex", alignItems: "flex-start", gap: 10,
                                                    }}>
                                                        <AlertTriangle size={15} style={{ color: "#f87171", flexShrink: 0, marginTop: 1 }} />
                                                        <span style={{ fontSize: 12, color: "#fca5a5", lineHeight: 1.5 }}>
                                                            <strong>Atenção:</strong> {mod.steps[currentStep].warning}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Step Navigation */}
                                        <div style={{
                                            display: "flex", justifyContent: "space-between", alignItems: "center",
                                            marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--border)",
                                        }}>
                                            <button
                                                onClick={() => setStepForModule(mod.id, Math.max(0, currentStep - 1))}
                                                disabled={currentStep === 0}
                                                style={{
                                                    padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)",
                                                    background: "transparent", color: currentStep === 0 ? "var(--fg-dim)" : "var(--fg)",
                                                    cursor: currentStep === 0 ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600,
                                                    opacity: currentStep === 0 ? 0.4 : 1, transition: "all 0.15s",
                                                }}
                                            >
                                                ← Anterior
                                            </button>

                                            {/* Progress dots */}
                                            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                                {mod.steps.map((_, idx) => (
                                                    <div key={idx}
                                                        onClick={() => setStepForModule(mod.id, idx)}
                                                        style={{
                                                            width: currentStep === idx ? 16 : 6,
                                                            height: 6,
                                                            borderRadius: 3,
                                                            background: currentStep === idx ? mod.color : "var(--border)",
                                                            cursor: "pointer",
                                                            transition: "all 0.2s",
                                                        }}
                                                    />
                                                ))}
                                            </div>

                                            <button
                                                onClick={() => setStepForModule(mod.id, Math.min(mod.steps.length - 1, currentStep + 1))}
                                                disabled={currentStep === mod.steps.length - 1}
                                                style={{
                                                    padding: "7px 14px", borderRadius: 8, border: "none",
                                                    background: currentStep === mod.steps.length - 1 ? "var(--border)" : mod.color,
                                                    color: "#fff",
                                                    cursor: currentStep === mod.steps.length - 1 ? "not-allowed" : "pointer",
                                                    fontSize: 12, fontWeight: 700,
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
                                            padding: "14px 24px 18px", borderTop: "1px solid var(--border)",
                                            background: "rgba(0,0,0,0.06)",
                                        }}>
                                            <h5 style={{
                                                fontSize: 11, fontWeight: 700, color: "var(--fg-dim)",
                                                textTransform: "uppercase", letterSpacing: "0.5px",
                                                margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6,
                                            }}>
                                                <Zap size={12} /> Dicas Gerais
                                            </h5>
                                            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                                {mod.tips.map((t, i) => (
                                                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                                        <CheckCircle2 size={13} style={{ color: mod.color, flexShrink: 0, marginTop: 2 }} />
                                                        <span style={{ fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.5 }}>{t}</span>
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
            </div>

            {/* ══════════ WORKFLOWS ══════════ */}
            <div className="card" style={{ borderLeft: "3px solid #818cf8" }}>
                <h3 style={{
                    fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 18px",
                    display: "flex", alignItems: "center", gap: 8,
                }}>
                    <ArrowRight size={18} style={{ color: "#818cf8" }} /> Fluxos Principais do Sistema
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                    {WORKFLOWS.map((wf, wfIdx) => (
                        <div key={wfIdx}>
                            <h4 style={{
                                fontSize: 12, fontWeight: 700, color: wf.color,
                                textTransform: "uppercase", letterSpacing: "0.5px",
                                margin: "0 0 10px",
                            }}>{wf.title}</h4>
                            <div style={{
                                display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap",
                            }}>
                                {wf.steps.map((step, i, arr) => (
                                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        <div style={{
                                            display: "flex", alignItems: "center", gap: 5,
                                            padding: "7px 12px", borderRadius: 8,
                                            background: `${wf.color}0D`, border: `1px solid ${wf.color}25`,
                                        }}>
                                            <span style={{ color: wf.color }}>{step.icon}</span>
                                            <span style={{ fontSize: 11, fontWeight: 600, color: wf.color }}>{step.label}</span>
                                        </div>
                                        {i < arr.length - 1 && (
                                            <ArrowRight size={12} style={{ color: "var(--fg-dim)", flexShrink: 0 }} />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ══════════ CARGOS ══════════ */}
            <div className="card" style={{ borderLeft: "3px solid #6366f1" }}>
                <h3 style={{
                    fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 16px",
                    display: "flex", alignItems: "center", gap: 8,
                }}>
                    <ShieldCheck size={18} style={{ color: "#6366f1" }} /> Níveis de Acesso
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
                    {[
                        { role: "ADMIN", label: "Administrador", desc: "Acesso total ao sistema. Pode excluir lotes, gerenciar usuários e produtos.", color: "#ef4444", icon: <Lock size={16} /> },
                        { role: "APROVADOR", label: "Aprovador", desc: "Pode autorizar saques, acessar disparos e aprovar solicitações de ônus.", color: "#f59e0b", icon: <CheckCircle size={16} /> },
                        { role: "USER", label: "Usuário", desc: "Acesso básico: faturamento, clientes, ajustes e lançamentos parciais.", color: "#818cf8", icon: <UserCircle size={16} /> },
                        { role: "CX", label: "Customer Experience", desc: "Foco em atendimento. Acesso apenas ao Rastreio de Saques.", color: "#14b8a6", icon: <Activity size={16} /> },
                    ].map(r => (
                        <div key={r.role} style={{
                            padding: "14px 16px", borderRadius: 10,
                            background: `${r.color}08`, border: `1px solid ${r.color}18`,
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                <span style={{ color: r.color }}>{r.icon}</span>
                                <span style={{ fontSize: 13, fontWeight: 800, color: r.color }}>{r.label}</span>
                                <span style={{
                                    fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 6,
                                    background: `${r.color}15`, color: r.color,
                                }}>{r.role}</span>
                            </div>
                            <p style={{ fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.5, margin: 0 }}>{r.desc}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* ══════════ ATALHOS ══════════ */}
            <div className="card" style={{ borderLeft: "3px solid #fbbf24" }}>
                <h3 style={{
                    fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 14px",
                    display: "flex", alignItems: "center", gap: 8,
                }}>
                    <Keyboard size={18} style={{ color: "#fbbf24" }} /> Atalhos Úteis
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8 }}>
                    {shortcuts.map((sc, i) => (
                        <div key={i} style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "9px 14px", borderRadius: 8,
                            background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.1)",
                        }}>
                            <div style={{ display: "flex", gap: 3 }}>
                                {sc.keys.map((k, j) => (
                                    <kbd key={j} style={{
                                        padding: "2px 7px", borderRadius: 5, fontSize: 11, fontWeight: 700,
                                        background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.2)",
                                        color: "#fbbf24", fontFamily: "monospace",
                                    }}>{k}</kbd>
                                ))}
                            </div>
                            <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>{sc.description}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* ══════════ FORMATOS ACEITOS ══════════ */}
            <div className="card" style={{ borderLeft: "3px solid #34d399" }}>
                <h3 style={{
                    fontSize: 15, fontWeight: 700, color: "#fff", margin: "0 0 14px",
                    display: "flex", alignItems: "center", gap: 8,
                }}>
                    <FileSpreadsheet size={18} style={{ color: "#34d399" }} /> Formatos Aceitos
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
                    <FormatCard
                        icon={<FileSpreadsheet size={15} />}
                        title="Planilhas"
                        formats={[".csv", ".xlsx", ".xls"]}
                        color="#34d399"
                    />
                    <FormatCard
                        icon={<FileArchive size={15} />}
                        title="XMLs de retorno"
                        formats={[".zip (contendo .xml)"]}
                        color="#818cf8"
                    />
                    <FormatCard
                        icon={<FileText size={15} />}
                        title="Documentos"
                        formats={[".pdf", ".png", ".jpg"]}
                        color="#f472b6"
                    />
                    <FormatCard
                        icon={<Info size={15} />}
                        title="Valores monetários"
                        formats={["1.234,56 (BR)", "1234.56 (EN)", "R$ 1.234,56"]}
                        color="#f59e0b"
                    />
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
            padding: "12px 14px", borderRadius: 10,
            background: `${color}08`, border: `1px solid ${color}15`,
            display: "flex", flexDirection: "column", gap: 8,
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color }}>
                {icon}
                <span style={{ fontSize: 12, fontWeight: 700 }}>{title}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {formats.map((f, i) => (
                    <span key={i} style={{
                        padding: "2px 8px", borderRadius: 5, fontSize: 11,
                        background: `${color}10`, color,
                        fontFamily: "monospace", fontWeight: 600,
                    }}>{f}</span>
                ))}
            </div>
        </div>
    );
}
