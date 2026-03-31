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
        const { loteId, assunto } = await request.json();
        if (!loteId) throw new Error("ID do Lote não fornecido.");

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

        const topic = pubsub.topic('topic-disparo-emails');
        const publishPromises: Promise<string>[] = [];
        const now = new Date();
        const mes = (now.getMonth() + 1).toString().padStart(2, '0');
        const ano = now.getFullYear().toString();

        // Pega a competência do lote (Ex: de "2026-03-31" vira "03/2026")
        // Se por algum motivo não houver data, usa o mês/ano atual
        const periodoFaturado = lote.data_competencia
            ? `${lote.data_competencia.split('-')[1]}/${lote.data_competencia.split('-')[0]}`
            : `${mes}/${ano}`;

        // 3. Loop de publicação (Um E-mail por Unidade/Loja)
        for (const item of consolidados) {
            const cliente: any = Array.isArray(item.clientes) ? item.clientes[0] : item.clientes;

            if (!cliente || !cliente.emails_faturamento) continue;

            const destinatarios = cliente.emails_faturamento;
            const cicloNome = cliente.ciclos_faturamento?.nome || "Geral";
            const clienteNome = cliente.nome || "";
            const razaoSocial = cliente.razao_social || "";
            const nomeContaAzul = cliente.nome_conta_azul || "";

            // 🎯 A MÁGICA 1: Define o nome exato da loja
            const nomeDaLoja = nomeContaAzul || razaoSocial || clienteNome;

            // 🚀 A MÁGICA 2: Replace das Variáveis no Assunto
            // Se o usuário não mandou nada do frontend, assume o seu padrão oficial
            const assuntoBase = assunto || "Faturamento iWof {Período faturado} | {Loja}";

            // Aplica as substituições (o "gi" faz buscar ignorando maiúsculas/minúsculas)
            const assuntoFinal = assuntoBase
                .replace(/{Loja}/gi, nomeDaLoja)
                .replace(/{Período faturado}/gi, periodoFaturado)
                .replace(/{Periodo faturado}/gi, periodoFaturado) // Fallback sem acento
                .replace(/{Ciclo}/gi, cicloNome); // Adicionei essa caso queira colocar "{Ciclo}" no front!

            // Gerar HTML via template usando o NOME DA LOJA para saudação
            const htmlBody = getBillingTemplate({
                clienteNome: nomeDaLoja,
                cicloNome,
                mes,
                ano
            });

            const payload = {
                loteId,
                clienteId: item.cliente_id,
                clienteNome,
                razaoSocial,
                nomeContaAzul,
                cicloNome,
                destinatarios,
                assunto: assuntoFinal, // Passa o assunto modificado com as tags substituídas!
                htmlBody,
                nomePastaLote: lote.nome_pasta,
                mes,
                ano
            };

            const dataBuffer = Buffer.from(JSON.stringify(payload));
            publishPromises.push(topic.publishMessage({ data: dataBuffer }));
        }

        // 4. Disparo simultâneo para o Pub/Sub
        if (publishPromises.length > 0) {
            await Promise.all(publishPromises);

            // 5. Atualizar status do lote
            await supabaseAdmin
                .from('faturamentos_lote')
                .update({ status: 'ENVIANDO' })
                .eq('id', loteId);
        }

        return NextResponse.json({
            success: true,
            message: `Disparo de ${publishPromises.length} e-mails (separados por unidade) iniciado via GCP Pub/Sub!`
        });

    } catch (error: any) {
        console.error("🚨 Erro na API de Pub/Sub Producer:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}