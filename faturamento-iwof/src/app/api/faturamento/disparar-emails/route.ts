import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { prepareEmailData } from '@/services/emailService';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
    try {
        const { loteId, assunto } = await request.json();
        if (!loteId) throw new Error("ID do Lote não fornecido.");

        // 1. Buscar os consolidados e os dados do cliente (Join)
        const { data: consolidados, error: consErr } = await supabaseAdmin
            .from('faturamento_consolidados')
            .select(`
                id,
                valor_bruto,
                valor_boleto_final,
                valor_nc_final,
                numero_nf,
                cliente_id,
                clientes ( nome, razao_social, emails_faturamento, nome_conta_azul, ciclos_faturamento ( nome ) )
            `)
            .eq('lote_id', loteId);

        if (consErr || !consolidados) throw new Error(`Erro ao buscar dados: ${consErr?.message}`);

        const resultados = [];

        // 2. Disparar e-mails individualmente via Email Service
        for (const item of consolidados) {
            const cliente: any = Array.isArray(item.clientes) ? item.clientes[0] : item.clientes;

            if (!cliente || !cliente.emails_faturamento) {
                resultados.push({ cliente: cliente?.nome || 'Desconhecido', status: 'Ignorado (Sem e-mail)' });
                continue;
            }

            const destinatarios = cliente.emails_faturamento;
            const cicloNome = cliente.ciclos_faturamento?.nome || "Geral";

            try {
                const res = await prepareEmailData(
                    loteId,
                    item.cliente_id,
                    cliente.nome || "",
                    cliente.razao_social || "",
                    cliente.nome_conta_azul || "",
                    cicloNome,
                    destinatarios,
                    assunto,
                    item.valor_bruto,
                    item.valor_boleto_final,
                    item.valor_nc_final,
                    item.numero_nf
                );
                resultados.push({ cliente: cliente.nome, status: 'Enviado', to: destinatarios, anexos: res.anexos_count });
            } catch (emailErr: any) {
                resultados.push({ cliente: cliente.nome, status: 'Erro', erro: emailErr.message });
            }
        }

        return NextResponse.json({ success: true, message: "Disparo concluído", resultados });

    } catch (error: any) {
        console.error("🚨 Erro Crítico na API de E-mails:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
