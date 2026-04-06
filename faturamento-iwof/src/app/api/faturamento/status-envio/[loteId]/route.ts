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
            .select('cliente_nome, destinatarios, status, mensagem_erro, created_at')
            .eq('lote_id', loteId)
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        const logsSucesso = (logs || []).filter(log => log.status === 'Sucesso');
        const logsErro = (logs || []).filter(log => log.status === 'Erro');

        // 3. Calcular quem ainda está na fila (não tem log de sucesso nem erro)
        const nomesProcessados = new Set(
            (logs || []).map(l => l.cliente_nome?.trim().toLowerCase())
        );

        const logsFila = todosDestinatarios.filter(
            (d: any) => !nomesProcessados.has(d.cliente_nome?.trim().toLowerCase())
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
            logsErro
        });

    } catch (error: any) {
        console.error("🚨 Erro na API de Status de Envio:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
