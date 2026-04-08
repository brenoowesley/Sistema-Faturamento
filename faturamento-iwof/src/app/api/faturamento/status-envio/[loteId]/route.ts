import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
    request: Request,
    { params }: { params: Promise<{ loteId: string }> | { loteId: string } }
) {
    try {
        // Resolve a promessa do params se necessário (compatibilidade Next 15+)
        const resolvedParams = await Promise.resolve(params);
        const { loteId } = resolvedParams;

        if (!loteId) {
            return NextResponse.json({ success: false, error: 'ID do Lote não fornecido' }, { status: 400 });
        }

        // 1. Buscar TODOS os consolidados do lote (= fila completa de destinatários)
        const { data: consolidados, error: consErr } = await supabaseAdmin
            .from('faturamento_consolidados')
            .select(`
                cliente_id,
                clientes ( razao_social, nome_fantasia, nome_conta_azul, emails_faturamento )
            `)
            .eq('lote_id', loteId);

        if (consErr) {
            console.error("Erro ao buscar consolidados:", consErr);
        }

        // Montar lista completa de destinatários esperados
        const todosDestinatarios = (consolidados || []).map((c: any) => {
            const cliente = Array.isArray(c.clientes) ? c.clientes[0] : c.clientes;
            return {
                cliente_id: c.cliente_id,
                cliente_nome: cliente?.nome_conta_azul || cliente?.razao_social || cliente?.nome_fantasia || "—",
                emails: cliente?.emails_faturamento || "",
            };
        });

        // 2. Buscar logs já processados
        const { data: logs, error } = await supabaseAdmin
            .from('logs_envio_email')
            .select('cliente_id, cliente_nome, destinatarios, status, mensagem_erro, created_at')
            .eq('lote_id', loteId)
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        const logsSucesso = (logs || []).filter(log => log.status === 'Sucesso');
        const logsErro = (logs || []).filter(log => log.status === 'Erro');

        // 3. Calcular quem ainda está na fila (não tem log de sucesso nem erro)
        //    Prioridade: compara por cliente_id (UUID, confiável).
        //    Fallback: compara por nome para logs antigos sem cliente_id.
        const idsProcessados = new Set(
            (logs || []).filter(l => l.cliente_id).map(l => l.cliente_id)
        );
        const nomesProcessados = new Set(
            (logs || []).filter(l => !l.cliente_id).map(l => l.cliente_nome?.trim().toLowerCase())
        );

        const logsFila = todosDestinatarios.filter(
            (d: any) => !idsProcessados.has(d.cliente_id) && !nomesProcessados.has(d.cliente_nome?.trim().toLowerCase())
        );

        // 4. Calcular "Não Enviados" = todos que NÃO têm log de Sucesso
        //    (inclui fila + erros — para o "Continuar Envio")
        const idsSucesso = new Set(
            logsSucesso.filter(l => l.cliente_id).map(l => l.cliente_id)
        );
        const nomesSucesso = new Set(
            logsSucesso.filter(l => !l.cliente_id).map(l => l.cliente_nome?.trim().toLowerCase())
        );

        const naoEnviados = todosDestinatarios.filter(
            (d: any) => !idsSucesso.has(d.cliente_id) && !nomesSucesso.has(d.cliente_nome?.trim().toLowerCase())
        );

        return NextResponse.json({
            success: true,
            totalEsperado: todosDestinatarios.length,
            total: (logs || []).length,
            sucesso: logsSucesso.length,
            erros: logsErro.length,
            fila: logsFila.length,
            logsFila,
            logsSucesso,
            logsErro,
            naoEnviados
        });

    } catch (error: any) {
        console.error("🚨 Erro na API de Status de Envio:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
