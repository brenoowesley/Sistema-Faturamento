import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PubSub } from '@google-cloud/pubsub';
import { getBillingTemplate } from '@/services/email/templates/billingTemplate';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
    try {
        const pubsub = new PubSub({
            projectId: 'faturamentoiwof',
            credentials: {
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            },
        });
        const { loteId, assunto, continuar } = await request.json();
        if (!loteId) throw new Error("ID do Lote não fornecido.");

        // ═══ LOCK OTIMISTA (CAS): Impedir disparos simultâneos ═══
        // Só permite disparar se o lote NÃO está em ENVIANDO nem CANCELADO.
        // Se "continuar", permite re-disparar a partir de ENVIANDO.
        const allowedStatuses = continuar
            ? ['ENVIANDO', 'PENDENTE', 'AGUARDANDO_XML', 'EM_ESPERA']
            : ['PENDENTE', 'AGUARDANDO_XML', 'EM_ESPERA', 'RASCUNHO'];

        const { data: lockData, error: lockErr } = await supabaseAdmin
            .from('faturamentos_lote')
            .update({ status: 'ENVIANDO' })
            .eq('id', loteId)
            .in('status', allowedStatuses)
            .select('id')
            .single();

        if (lockErr || !lockData) {
            return NextResponse.json({
                success: false,
                error: 'Este lote já está em processo de envio ou foi cancelado. Aguarde a conclusão.'
            }, { status: 409 });
        }

        // Se "Continuar Envio": limpar logs de Erro e Processando da última tentativa
        if (continuar) {
            await supabaseAdmin
                .from('logs_envio_email')
                .delete()
                .eq('lote_id', loteId)
                .in('status', ['Erro', 'Processando']);
        }

        // 1. Buscar o lote (para nome_pasta e data_competencia)
        const { data: lote, error: loteErr } = await supabaseAdmin
            .from('faturamentos_lote')
            .select('nome_pasta, data_competencia')
            .eq('id', loteId)
            .single();

        if (loteErr || !lote) throw new Error(`Lote não encontrado: ${loteErr?.message}`);

        // 2. Buscar consolidados + dados do cliente
        const { data: consolidados, error: consErr } = await supabaseAdmin
            .from('faturamento_consolidados')
            .select(`
                id,
                cliente_id,
                clientes ( nome, razao_social, emails_faturamento, nome_conta_azul, ciclos_faturamento ( nome ) )
            `)
            .eq('lote_id', loteId);

        if (consErr || !consolidados) throw new Error(`Erro ao buscar consolidados: ${consErr?.message}`);

        // 3. Buscar logs já processados para idempotência (não republicar quem já recebeu)
        const { data: logsExistentes } = await supabaseAdmin
            .from('logs_envio_email')
            .select('cliente_id, status')
            .eq('lote_id', loteId);

        const clientesJaProcessados = new Set(
            (logsExistentes || [])
                .filter(l => l.cliente_id)
                .map(l => l.cliente_id)
        );

        const topic = pubsub.topic('topic-disparo-emails');
        const publishPromises: Promise<string>[] = [];
        const now = new Date();
        const mes = (now.getMonth() + 1).toString().padStart(2, '0');
        const ano = now.getFullYear().toString();

        // Pega a competência do lote (Ex: de "2026-03-31" vira "03/2026")
        const periodoFaturado = lote.data_competencia
            ? `${lote.data_competencia.split('-')[1]}/${lote.data_competencia.split('-')[0]}`
            : `${mes}/${ano}`;

        let skippedCount = 0;
        let alreadySentCount = 0;

        // 4. Loop de publicação (Um E-mail por Unidade/Loja)
        for (const item of consolidados) {
            const cliente: any = Array.isArray(item.clientes) ? item.clientes[0] : item.clientes;
            const nomeParaLog = cliente?.nome_conta_azul || cliente?.razao_social || cliente?.nome || '—';

            // Idempotência: pular quem já tem log (sucesso ou erro)
            if (clientesJaProcessados.has(item.cliente_id)) {
                alreadySentCount++;
                continue;
            }

            // Registrar em memória que este cliente já foi processado nesta execução
            // Isso evita disparos duplos caso o banco de dados retorne múltiplas linhas para o mesmo cliente
            clientesJaProcessados.add(item.cliente_id);

            // Sem e-mail configurado → registrar como falha imediatamente (não vai pro Pub/Sub)
            if (!cliente || !cliente.emails_faturamento || cliente.emails_faturamento.trim() === '') {
                await supabaseAdmin.from('logs_envio_email').insert({
                    lote_id: loteId,
                    cliente_id: item.cliente_id,
                    cliente_nome: nomeParaLog,
                    destinatarios: '',
                    assunto: '',
                    status: 'Erro',
                    mensagem_erro: 'Campo emails_faturamento vazio — cadastro sem e-mail configurado.'
                });
                skippedCount++;
                continue;
            }

            const destinatarios = cliente.emails_faturamento;
            const cicloNome = cliente.ciclos_faturamento?.nome || "Geral";
            const clienteNome = cliente.nome || "";
            const razaoSocial = cliente.razao_social || "";
            const nomeContaAzul = cliente.nome_conta_azul || "";
            const nomeDaLoja = nomeContaAzul || razaoSocial || clienteNome;

            // Montar assunto com variáveis
            const assuntoBase = assunto || "Faturamento iWof {Período faturado} | {Loja}";
            const assuntoFinal = assuntoBase
                .replace(/{Loja}/gi, nomeDaLoja)
                .replace(/{Período faturado}/gi, periodoFaturado)
                .replace(/{Periodo faturado}/gi, periodoFaturado)
                .replace(/{Ciclo}/gi, cicloNome);

            const payload = {
                loteId,
                clienteId: item.cliente_id,
                clienteNome,
                razaoSocial,
                nomeContaAzul,
                cicloNome,
                destinatarios,
                assunto: assuntoFinal,
                nomePastaLote: lote.nome_pasta,
                mes,
                ano
            };

            const dataBuffer = Buffer.from(JSON.stringify(payload));
            publishPromises.push(topic.publishMessage({ data: dataBuffer }));
        }

        // 5. Disparo simultâneo para o Pub/Sub
        // O status já foi marcado como ENVIANDO pelo CAS lock acima.
        if (publishPromises.length > 0) {
            await Promise.all(publishPromises);
        }

        return NextResponse.json({
            success: true,
            message: `Disparo de ${publishPromises.length} e-mails iniciado via GCP!${skippedCount > 0 ? ` (${skippedCount} sem e-mail registrados como falha)` : ''}${alreadySentCount > 0 ? ` (${alreadySentCount} já processados anteriormente)` : ''}`
        });

    } catch (error: any) {
        console.error("🚨 Erro na API de Disparo de E-mails:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}