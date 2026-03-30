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

        // Buscar todos os logs para o lote
        const { data: logs, error } = await supabaseAdmin
            .from('logs_envio_email')
            .select('cliente_nome, destinatarios, status, mensagem_erro, created_at')
            .eq('lote_id', loteId)
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        if (!logs) {
            return NextResponse.json({
                success: true,
                total: 0,
                sucesso: 0,
                erros: 0,
                logsSucesso: [],
                logsErro: []
            });
        }

        const logsSucesso = logs.filter(log => log.status === 'Sucesso');
        const logsErro = logs.filter(log => log.status === 'Erro');

        // Contagem atualizada baseada na base de dados
        return NextResponse.json({
            success: true,
            total: logs.length,
            sucesso: logsSucesso.length,
            erros: logsErro.length,
            logsSucesso,
            logsErro
        });

    } catch (error: any) {
        console.error("🚨 Erro na API de Status de Envio:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
