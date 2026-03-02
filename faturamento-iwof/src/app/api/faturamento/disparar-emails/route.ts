import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
    try {
        const { loteId } = await request.json();
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
                clientes ( nome, razao_social, emails_faturamento )
            `)
            .eq('lote_id', loteId);

        if (consErr || !consolidados) throw new Error(`Erro ao buscar dados: ${consErr?.message}`);

        // 2. Configurar o Transportador de E-mail (SMTP)
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com', // Padrão Gmail/Google Workspace
            port: parseInt(process.env.SMTP_PORT || '465'),
            secure: process.env.SMTP_PORT === '465',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            }
        });

        const resultados = [];

        // 3. Disparar e-mails individualmente
        for (const item of consolidados) {
            const cliente = Array.isArray(item.clientes) ? item.clientes[0] : item.clientes;

            if (!cliente || !cliente.emails_faturamento) {
                resultados.push({ cliente: cliente?.nome || 'Desconhecido', status: 'Ignorado (Sem e-mail)' });
                continue;
            }

            // Lógica de TO e CC baseada na separação por vírgula ou ponto-e-vírgula
            const emailList = cliente.emails_faturamento
                .split(/[,;]+/)
                .map((e: string) => e.trim())
                .filter((e: string) => e.length > 0);

            if (emailList.length === 0) continue;

            const to = emailList[0];
            const cc = emailList.slice(1).join(', ');

            // Formatação de Moeda
            const fmtBRL = (valor: number) => `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

            const mailOptions = {
                from: `"Financeiro iWof" <${process.env.SMTP_USER}>`,
                to,
                cc: cc.length > 0 ? cc : undefined,
                subject: `Faturamento Mensal - ${cliente.razao_social || cliente.nome}`,
                html: `
                    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; line-height: 1.6;">
                        <h2 style="color: #0056b3;">Olá, equipe da ${cliente.nome}!</h2>
                        <p>O faturamento referente a este ciclo já se encontra disponível e consolidado em nosso sistema.</p>
                        
                        <div style="background-color: #f8f9fa; padding: 15px; border-left: 4px solid #0056b3; margin: 20px 0;">
                            <ul style="list-style-type: none; padding: 0; margin: 0;">
                                <li><strong>Valor Bruto dos Serviços:</strong> ${fmtBRL(item.valor_bruto)}</li>
                                ${item.valor_boleto_final > 0 ?\`<li><strong style="color: #28a745;">Valor Líquido do Boleto:</strong> \${fmtBRL(item.valor_boleto_final)}</li>\` : ''}
                                \${item.valor_nc_final > 0 ? \`<li><strong style="color: #dc3545;">Nota de Crédito Provisionada:</strong> \${fmtBRL(item.valor_nc_final)}</li>\` : ''}
                                \${item.numero_nf ? \`<li><strong>Nota Fiscal:</strong> \${item.numero_nf}</li>\` : ''}
                            </ul>
                        </div>

                        <p>Os documentos fiscais (NFSe, Boletos e HCs) foram processados e podem ser acessados através da sua pasta ou plataforma oficial.</p>
                        <p>Qualquer dúvida sobre os lançamentos, estamos à disposição para esclarecimentos.</p>
                        <br>
                        <p>Atenciosamente,<br><strong>Departamento Financeiro - iWof</strong></p>
                    </div>
                `
        };

        try {
            await transporter.sendMail(mailOptions);
            resultados.push({ cliente: cliente.nome, status: 'Enviado', to, cc });
        } catch (emailErr: any) {
            console.error(`Erro ao enviar e-mail para \${cliente.nome}:`, emailErr);
            resultados.push({ cliente: cliente.nome, status: 'Erro', erro: emailErr.message });
        }
    }

        return NextResponse.json({ success: true, message: "Disparo concluído", resultados });

} catch (error: any) {
    console.error("🚨 Erro Crítico na API de E-mails:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
}
}
