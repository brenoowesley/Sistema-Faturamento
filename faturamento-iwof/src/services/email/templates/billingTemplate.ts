/**
 * Template de E-mail de Faturamento iWof
 * @param data Dados dinâmicos do faturamento
 * @returns HTML string pronta para envio
 */
export function getBillingTemplate(data: {
    clienteNome: string;
    valorBruto: number;
    valorLiquidoBoleto: number;
    valorNC: number;
    numeroNF: string | null;
}) {
    const fmtBRL = (valor: number) => `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
            <div style="background-color: #0056b3; padding: 20px; text-align: center;">
                <h2 style="color: #ffffff; margin: 0; font-size: 24px;">Faturamento Mensal iWof</h2>
            </div>
            <div style="padding: 30px;">
                <h3 style="color: #333; margin-top: 0;">Olá, equipe da ${data.clienteNome}!</h3>
                <p style="color: #555; line-height: 1.6;">O faturamento referente a este ciclo já se encontra disponível e consolidado em nosso sistema.</p>
                
                <div style="background-color: #f8f9fa; padding: 20px; border-left: 4px solid #0056b3; margin: 25px 0; border-radius: 0 8px 8px 0;">
                    <h4 style="margin-top: 0; color: #0056b3; margin-bottom: 15px;">Resumo Financeiro</h4>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; color: #555; border-bottom: 1px solid #eee;">Valor Bruto dos Serviços:</td>
                            <td style="padding: 8px 0; text-align: right; font-weight: bold; border-bottom: 1px solid #eee;">${fmtBRL(data.valorBruto)}</td>
                        </tr>
                        ${data.valorLiquidoBoleto > 0 ? `
                        <tr>
                            <td style="padding: 8px 0; color: #555; border-bottom: 1px solid #eee;">Valor Líquido do Boleto:</td>
                            <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #28a745; border-bottom: 1px solid #eee;">${fmtBRL(data.valorLiquidoBoleto)}</td>
                        </tr>` : ''}
                        ${data.valorNC > 0 ? `
                        <tr>
                            <td style="padding: 8px 0; color: #555; border-bottom: 1px solid #eee;">Nota de Crédito Provisionada:</td>
                            <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #dc3545; border-bottom: 1px solid #eee;">${fmtBRL(data.valorNC)}</td>
                        </tr>` : ''}
                        ${data.numeroNF ? `
                        <tr>
                            <td style="padding: 8px 0; color: #555;">Nota Fiscal:</td>
                            <td style="padding: 8px 0; text-align: right; font-weight: bold;">${data.numeroNF}</td>
                        </tr>` : ''}
                    </table>
                </div>

                <p style="color: #555; line-height: 1.6;">Os documentos fiscais (NFSe, Boletos e Recibos) já processados estão anexados a este e-mail para o fechamento fiscal.</p>
                <br>
                <p style="color: #555; line-height: 1.6;">Atenciosamente,<br><strong>Departamento Financeiro - iWof</strong></p>
            </div>
            <div style="background-color: #f1f3f5; padding: 15px; text-align: center; font-size: 12px; color: #888;">
                Esta é uma mensagem automática gerada pelo Sistema de Faturamento iWof. Não é necessário responder.
            </div>
        </div>
    `;
}
