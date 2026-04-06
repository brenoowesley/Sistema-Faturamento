import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendText, sendPresence, randomSleep } from "@/lib/evolutionApi";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/* ================================================================
   TYPES
   ================================================================ */

interface DestinatarioPayload {
  cnpj: string;
  telefone: string;
  clienteId: string | null;
  nomeFantasia: string;
  razaoSocial: string;
  primeiroNome: string;
  valorTotal: number;
  vencimento: string;
}

interface DisparoRequest {
  destinatarios: DestinatarioPayload[];
  mensagem: string;
  loteId: string | null;
  nomeLote: string;
}

/* ================================================================
   POST /api/whatsapp/disparar
   Disparo sequencial com anti-spam (streaming de progresso)
   ================================================================ */

export async function POST(request: Request) {
  try {
    const body: DisparoRequest = await request.json();
    const { destinatarios, mensagem, loteId, nomeLote } = body;

    if (!destinatarios || destinatarios.length === 0) {
      return NextResponse.json(
        { error: "Nenhum destinatário fornecido." },
        { status: 400 }
      );
    }

    if (!mensagem) {
      return NextResponse.json(
        { error: "Mensagem não pode ser vazia." },
        { status: 400 }
      );
    }

    // ============================================================
    // STREAMING: Envia progresso em tempo real via ReadableStream
    // ============================================================
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        };

        let enviados = 0;
        let erros = 0;
        let ignorados = 0;

        send({
          type: "START",
          total: destinatarios.length,
          message: `Iniciando disparo para ${destinatarios.length} destinatários...`,
        });

        for (let i = 0; i < destinatarios.length; i++) {
          const dest = destinatarios[i];
          const idx = i + 1;

          // ========================================================
          // VERIFICAÇÃO DE IDEMPOTÊNCIA
          // ========================================================
          if (loteId) {
            const { data: existing } = await supabaseAdmin
              .from("disparo_logs")
              .select("id, status")
              .eq("lote_id", loteId)
              .eq("cnpj", dest.cnpj)
              .single();

            if (existing && existing.status === "ENVIADO") {
              ignorados++;
              send({
                type: "SKIP",
                index: idx,
                cnpj: dest.cnpj,
                nome: dest.nomeFantasia || dest.razaoSocial,
                message: `[${idx}/${destinatarios.length}] ⏭️ ${dest.nomeFantasia || dest.razaoSocial} — Já enviado neste lote.`,
              });
              continue;
            }
          }

          // ========================================================
          // REGISTRO DE LOG (PENDENTE)
          // ========================================================
          const logPayload: Record<string, unknown> = {
            cnpj: dest.cnpj,
            telefone: dest.telefone,
            status: "PENDENTE",
            ...(loteId ? { lote_id: loteId } : {}),
          };

          const { data: logEntry, error: logErr } = await supabaseAdmin
            .from("disparo_logs")
            .upsert(logPayload, {
              onConflict: "lote_id,cnpj",
            })
            .select("id")
            .single();

          if (logErr) {
            console.error(`Log upsert error for ${dest.cnpj}:`, logErr);
          }

          // ========================================================
          // PRESENCE SIMULATION: "Digitando..." por 2 segundos
          // ========================================================
          try {
            send({
              type: "COMPOSING",
              index: idx,
              nome: dest.nomeFantasia || dest.razaoSocial,
              message: `[${idx}/${destinatarios.length}] ✍️ Digitando para ${dest.nomeFantasia || dest.razaoSocial}...`,
            });

            await sendPresence(dest.telefone, "composing");
            await new Promise((r) => setTimeout(r, 2000));
            await sendPresence(dest.telefone, "paused");
          } catch (presErr) {
            console.warn("Presence error (non-critical):", presErr);
          }

          // ========================================================
          // SUBSTITUIÇÃO DE VARIÁVEIS
          // ========================================================
          const msgFinal = mensagem
            .replace(/\{\{nome_fantasia\}\}/gi, dest.nomeFantasia || "")
            .replace(/\{\{razao_social\}\}/gi, dest.razaoSocial || "")
            .replace(/\{\{primeiro_nome\}\}/gi, dest.primeiroNome || "")
            .replace(
              /\{\{valor_total\}\}/gi,
              dest.valorTotal
                ? new Intl.NumberFormat("pt-BR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }).format(dest.valorTotal)
                : "—"
            )
            .replace(/\{\{vencimento\}\}/gi, dest.vencimento || "—")
            .replace(/\{\{nome_lote\}\}/gi, nomeLote || "");

          // ========================================================
          // ENVIO DA MENSAGEM
          // ========================================================
          try {
            await sendText(dest.telefone, msgFinal);
            enviados++;

            // Atualizar log para ENVIADO
            if (logEntry?.id) {
              await supabaseAdmin
                .from("disparo_logs")
                .update({
                  status: "ENVIADO",
                  enviado_em: new Date().toISOString(),
                })
                .eq("id", logEntry.id);
            }

            send({
              type: "SENT",
              index: idx,
              cnpj: dest.cnpj,
              nome: dest.nomeFantasia || dest.razaoSocial,
              enviados,
              erros,
              message: `[${idx}/${destinatarios.length}] ✅ Enviado para ${dest.nomeFantasia || dest.razaoSocial}`,
            });
          } catch (sendErr: any) {
            erros++;

            // Atualizar log para ERRO
            if (logEntry?.id) {
              await supabaseAdmin
                .from("disparo_logs")
                .update({
                  status: "ERRO",
                  error_message: sendErr.message?.slice(0, 500),
                  enviado_em: new Date().toISOString(),
                })
                .eq("id", logEntry.id);
            }

            send({
              type: "ERROR",
              index: idx,
              cnpj: dest.cnpj,
              nome: dest.nomeFantasia || dest.razaoSocial,
              enviados,
              erros,
              message: `[${idx}/${destinatarios.length}] ❌ Erro ao enviar para ${dest.nomeFantasia || dest.razaoSocial}: ${sendErr.message}`,
            });
          }

          // ========================================================
          // ANTI-SPAM: Delays entre mensagens
          // ========================================================
          if (i < destinatarios.length - 1) {
            // Pausa de descanso a cada 20 mensagens (3 a 7 minutos)
            if ((i + 1) % 20 === 0) {
              const pausaMs = Math.floor(
                Math.random() * (420000 - 180000 + 1) + 180000
              );
              const pausaMin = (pausaMs / 60000).toFixed(1);

              send({
                type: "REST_PAUSE",
                index: idx,
                message: `⏸️ Pausa de descanso anti-spam: ${pausaMin} minutos (${enviados} mensagens enviadas)...`,
                delayMs: pausaMs,
              });

              await new Promise((r) => setTimeout(r, pausaMs));
            } else {
              // Delay aleatório entre 15 e 45 segundos
              const delayMs = await randomSleep(15000, 45000);
              const delaySec = (delayMs / 1000).toFixed(0);

              send({
                type: "WAITING",
                index: idx,
                message: `⏳ Aguardando ${delaySec}s antes do próximo envio...`,
                delayMs,
              });
            }
          }
        }

        // ========================================================
        // RESULTADO FINAL
        // ========================================================
        send({
          type: "COMPLETE",
          enviados,
          erros,
          ignorados,
          total: destinatarios.length,
          message: `🏁 Disparo finalizado! Enviados: ${enviados} | Erros: ${erros} | Ignorados: ${ignorados}`,
        });

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("🚨 Erro na API de Disparo WhatsApp:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
