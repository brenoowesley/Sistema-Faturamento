import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
    try {
        const { loteId } = await request.json();
        if (!loteId) {
            return NextResponse.json({ success: false, error: 'ID do Lote não fornecido.' }, { status: 400 });
        }

        // 1. Verificar status atual do lote
        const { data: lote, error: loteErr } = await supabaseAdmin
            .from('faturamentos_lote')
            .select('id, status')
            .eq('id', loteId)
            .single();

        if (loteErr || !lote) {
            return NextResponse.json({ success: false, error: `Lote não encontrado: ${loteErr?.message}` }, { status: 404 });
        }

        if (lote.status === 'CANCELADO') {
            return NextResponse.json({ success: false, error: 'Este lote já foi cancelado.' }, { status: 400 });
        }

        // 2. Marcar lote como CANCELADO
        const { error: updateErr } = await supabaseAdmin
            .from('faturamentos_lote')
            .update({ status: 'CANCELADO' })
            .eq('id', loteId);

        if (updateErr) {
            throw new Error(`Erro ao atualizar status: ${updateErr.message}`);
        }

        // 3. Contar quantos estavam na fila (sem log de sucesso nem erro)
        const { data: consolidados } = await supabaseAdmin
            .from('faturamento_consolidados')
            .select('cliente_id')
            .eq('lote_id', loteId);

        const { data: logs } = await supabaseAdmin
            .from('logs_envio_email')
            .select('cliente_id')
            .eq('lote_id', loteId);

        const idsProcessados = new Set((logs || []).map(l => l.cliente_id).filter(Boolean));
        const pendentes = (consolidados || []).filter(c => !idsProcessados.has(c.cliente_id));

        console.log(`[PARAR-ENVIO] Lote ${loteId.slice(0, 8)} cancelado. ${pendentes.length} e-mails pendentes não serão enviados.`);

        return NextResponse.json({
            success: true,
            message: `Envio cancelado com sucesso. ${pendentes.length} e-mail(s) pendente(s) não serão enviados.`,
            pendentesCancelados: pendentes.length,
            jaEnviados: idsProcessados.size
        });

    } catch (error: any) {
        console.error('🚨 Erro na API de Parar Envio:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
