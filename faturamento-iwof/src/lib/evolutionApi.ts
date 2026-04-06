/**
 * Evolution API v2.2.3 — HTTP Client
 * Base URL: http://127.0.0.1:8080
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
    throw new Error(
      `Evolution API error [${res.status}]: ${errorBody}`
    );
  }

  return res.json();
}

/**
 * Envia uma mensagem de texto para um número.
 * Formato do número: "5511999999999" (código do país + DDD + número)
 */
export async function sendText(phone: string, message: string) {
  const number = phone.replace(/\D/g, "");

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
  const number = phone.replace(/\D/g, "");

  return evolutionFetch(`/chat/sendPresence/${SAFE_INSTANCE}`, {
    method: "POST",
    body: JSON.stringify({
      number,
      presence: state,
    }),
  });
}

/**
 * Verifica se um número é um número válido de WhatsApp.
 */
export async function checkNumber(phone: string) {
  const number = phone.replace(/\D/g, "");

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