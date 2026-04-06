/**
 * Evolution API v2.2.3 — HTTP Client
 * Base URL: http://127.0.0.1:8080 (ou URL do Ngrok configurada no .env)
 *
 * Documentação: https://doc.evolution-api.com/v2
 */

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || "http://127.0.0.1:8080";
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "";
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "";

// Encodando a instância para evitar quebra de URL (ex: "Disparos - Financeiro" vira "Disparos%20-%20Financeiro")
const SAFE_INSTANCE = encodeURIComponent(EVOLUTION_INSTANCE);

interface EvolutionResponse {
  key?: { remoteJid: string; fromMe: boolean; id: string };
  message?: Record<string, unknown>;
  status?: string;
  error?: string;
}

/**
 * Faz uma requisição autenticada para a Evolution API
 */
async function evolutionFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<EvolutionResponse> {
  const url = `${EVOLUTION_API_URL}${endpoint}`;

  // 1. LOG DE PRÉ-VÔO: O que exatamente estamos tentando acessar?
  console.log("=========================================");
  console.log("🚀 [DEBUG EVOLUTION API] TENTANDO CONECTAR...");
  console.log(`🔗 URL Exata: ${url}`);
  console.log(`🔑 API Key (Primeiros 5 chars): ${EVOLUTION_API_KEY.substring(0, 5)}***`);
  console.log(`📦 Método: ${options.method || "GET"}`);
  console.log("=========================================");

  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        apikey: EVOLUTION_API_KEY,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`❌ [DEBUG] Erro da API HTTP ${res.status}:`, errorBody);
      throw new Error(`Evolution API error [${res.status}]: ${errorBody}`);
    }

    console.log("✅ [DEBUG] Sucesso! A API respondeu.");
    return res.json();

  } catch (error: any) {
    // 2. LOG DE ACIDENTE: Descobrindo a causa real do "fetch failed"
    console.error("=========================================");
    console.error("💥 [DEBUG FATAL] A REQUISIÇÃO FALHOU ANTES DE CHEGAR NA API!");
    console.error(`Mensagem Genérica: ${error.message}`);

    // Aqui está o ouro: o Node.js esconde o erro real dentro de 'cause'
    if (error.cause) {
      console.error(`🕵️ Causa Raiz (Código do Erro):`, error.cause.code);
      console.error(`🕵️ Detalhes da Causa:`, error.cause);
    }
    console.error("=========================================");
    throw error;
  }
}

/**
 * Utilitário: Formata o número garantindo o DDI 55 e removendo caracteres
 */
function formatWhatsAppNumber(phone: string): string {
  let number = phone.replace(/\D/g, "");

  // Blindagem: Se tiver 10 ou 11 dígitos (apenas DDD e número), adiciona o DDI do Brasil (55)
  if (number.length === 10 || number.length === 11) {
    number = `55${number}`;
  }

  return number;
}

/**
 * Envia uma mensagem de texto para um número.
 * Formato do número: "5511999999999" (código do país + DDD + número)
 */
export async function sendText(phone: string, message: string) {
  const number = formatWhatsAppNumber(phone);

  return evolutionFetch(`/message/sendText/${SAFE_INSTANCE}`, {
    method: "POST",
    body: JSON.stringify({
      number,
      text: message,
      // Otimização: A própria Evolution já cuida de simular o "digitando..." se passarmos as opções aqui!
      options: {
        delay: 1500,
        presence: "composing"
      }
    }),
  });
}

/**
 * Envia o status de presença (composing/paused/recording/available).
 * Simula "digitando..." antes do envio para parecer humano.
 */
export async function sendPresence(
  phone: string,
  state: "composing" | "paused" | "recording" | "available" = "composing"
) {
  const number = formatWhatsAppNumber(phone);

  return evolutionFetch(`/chat/sendPresence/${SAFE_INSTANCE}`, {
    method: "POST",
    body: JSON.stringify({
      number,
      presence: state,
      delay: 1500 // CORREÇÃO: Tempo de delay exigido pela Evolution API v2.2.3
    }),
  });
}

/**
 * Verifica se um número é um número válido de WhatsApp.
 */
export async function checkNumber(phone: string) {
  const number = formatWhatsAppNumber(phone);

  return evolutionFetch(`/chat/whatsappNumbers/${SAFE_INSTANCE}`, {
    method: "POST",
    body: JSON.stringify({
      numbers: [number],
    }),
  });
}

/**
 * Utilitário: sleep com duração aleatória entre min e max (ms)
 */
export function randomSleep(minMs: number, maxMs: number): Promise<number> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(() => resolve(delay), delay));
}