// ─── Token Cache ────────────────────────────────────────────────────────────────
let cachedTransfeeraToken: string | null = null;
let tokenExpiryTime: number | null = null;

export async function getTransfeeraToken() {
    if (cachedTransfeeraToken && tokenExpiryTime && Date.now() < tokenExpiryTime) {
        return cachedTransfeeraToken;
    }

    const clientId = process.env.TRANSFEERA_CLIENT_ID;
    const clientSecret = process.env.TRANSFEERA_CLIENT_SECRET;

    const loginBase = process.env.TRANSFEERA_ENV === "sandbox"
        ? "https://login-api-sandbox.transfeera.com"
        : "https://login-api.transfeera.com";

    if (!clientId || !clientSecret) {
        console.error("Transfeera Error: Missing TRANSFEERA_CLIENT_ID or TRANSFEERA_CLIENT_SECRET");
        throw new Error("Configuração de API ausente no servidor");
    }

    const response = await fetch(`${loginBase}/authorization`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": "IWOF - Sistema de Faturamento (breno@iwof.com.br)"
        },
        body: JSON.stringify({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret
        })
    });

    if (!response.ok) {
        const errBody = await response.text();
        console.error(`Transfeera Auth Error: Status ${response.status} - Body: ${errBody}`);
        throw new Error(`Transfeera Auth Error: ${response.status}`);
    }

    const data = await response.json();
    cachedTransfeeraToken = data.access_token;
    const expiresInSecs = data.expires_in || 3600;
    tokenExpiryTime = Date.now() + (expiresInSecs - 60) * 1000;

    return cachedTransfeeraToken;
}

export function getTransfeeraBaseUrl() {
    return process.env.TRANSFEERA_ENV === "sandbox"
        ? "https://api-sandbox.transfeera.com"
        : "https://api.transfeera.com";
}

export const UA_HEADER = "IWOF - Sistema de Faturamento (breno@iwof.com.br)";

/**
 * Formata a chave PIX conforme as exigências da Transfeera.
 * Especialmente para TELEFONE, que exige o formato E.164 (+55...)
 */
export function formatarChavePix(tipo: string, chave: string): string {
    const t = tipo.toUpperCase();
    const c = (chave || "").trim();
    
    if (t === "TELEFONE") {
        const apenasNumeros = c.replace(/\D/g, "");
        if (apenasNumeros.length === 10 || apenasNumeros.length === 11) {
            return `+55${apenasNumeros}`;
        }
        if (apenasNumeros.startsWith("55") && (apenasNumeros.length === 12 || apenasNumeros.length === 13)) {
            return `+${apenasNumeros}`;
        }
        return c;
    }
    
    return c;
}

export function normalizePixKeyType(tipo: string): string {
    const map: Record<string, string> = {
        "EMAIL": "EMAIL",
        "CPF": "CPF",
        "CNPJ": "CNPJ",
        "TELEFONE": "TELEFONE",
        "CHAVE_ALEATORIA": "CHAVE_ALEATORIA",
        "EVP": "CHAVE_ALEATORIA",
        "ALEATORIO": "CHAVE_ALEATORIA",
    };
    return map[(tipo || "").toUpperCase()] || tipo;
}

export function normalizeTransfeeraStatus(raw: string): string {
    if (!raw) return "NAO_SUBMETIDO";
    const s = raw.toUpperCase().trim();
    const map: Record<string, string> = {
        FINALIZADO: "FINALIZADO",
        EFETIVADO: "EFETIVADO",
        PAGO: "FINALIZADO",
        CONCLUIDO: "FINALIZADO",
        CONCLUÍDO: "FINALIZADO",
        EM_PROCESSAMENTO: "EM_PROCESSAMENTO",
        PROCESSANDO: "EM_PROCESSAMENTO",
        EM_PROCESSAMENTO_BANCO: "EM_PROCESSAMENTO",
        AGENDADO: "AGENDADO",
        SCHEDULED: "AGENDADO",
        DEVOLVIDO: "DEVOLVIDO",
        RETURNED: "DEVOLVIDO",
        FALHA: "FALHA",
        FAILED: "FALHA",
        ERROR: "FALHA",
        CRIADO: "AGENDADO",
        CREATED: "AGENDADO",
    };
    return map[s] ?? raw;
}
