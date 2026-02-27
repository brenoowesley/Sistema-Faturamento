import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_FINANCEIRO_USER,
        pass: process.env.EMAIL_FINANCEIRO_PASS,
    }
});

function buildFaturaEmailHtml(templateDados: { cicloFolder: string, subfolderName: string, currentMonth: string, currentYear: string }) {
    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); }
        .header { background-color: #1c5d99; color: #ffffff; text-align: center; padding: 20px; }
        .content { padding: 30px; line-height: 1.6; color: #333333; }
        .footer { background-color: #f8f9fa; color: #6c757d; text-align: center; padding: 15px; font-size: 12px; }
        h1 { margin: 0; font-size: 24px; }
        .highlight { font-weight: bold; color: #2176ff; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Faturamento iWof</h1>
        </div>
        <div class="content">
            <p>Olá equipe <strong>${templateDados.subfolderName}</strong>,</p>
            <p>Segue em anexo o faturamento referente ao período <strong>${templateDados.currentMonth}/${templateDados.currentYear}</strong>.</p>
            <p>Ciclo de faturamento: <span class="highlight">${templateDados.cicloFolder}</span>.</p>
            <hr>
            <p>Os documentos anexados incluem:</p>
            <ul>
                <li>Boleto Bancário</li>
                <li>Nota Fiscal de Serviço (NFS-e)</li>
            </ul>
            <p>Por favor, certifique-se de realizar o pagamento até a data de vencimento estipulada no boleto.</p>
            <p>Qualquer dúvida, nossa equipe financeira está à disposição para auxiliar.</p>
        </div>
        <div class="footer">
            <p>Este é um e-mail automático enviado pelo sistema de Faturamento iWof. Por favor, não responda a este e-mail.</p>
            <p>&copy; ${templateDados.currentYear} iWof. Todos os direitos reservados.</p>
        </div>
    </div>
</body>
</html>
    `;
}

export async function POST(request: Request) {
    try {
        // Here you would parse request.json(), or fetch directly from the DB regarding the recent Lote
        // Because this is a migration, we are mocking the success of fetching Drive files and sending emails
        console.log('[Next.js API] Iniciando disparo de e-mails de Faturamento...');

        const dt = new Date();
        const currentYear = dt.getFullYear().toString();
        const currentMonth = (dt.getMonth() + 1).toString().padStart(2, '0');

        const mockTemplateData = {
            cicloFolder: "M2",
            subfolderName: "Cliente Exemplo SA",
            currentMonth,
            currentYear
        };

        const htmlContent = buildFaturaEmailHtml(mockTemplateData);

        const mailOptions = {
            from: `"Financeiro iWof" <${process.env.EMAIL_FINANCEIRO_USER}>`,
            to: process.env.EMAIL_FINANCEIRO_USER, // Para testes manda pra ele mesmo
            subject: `Faturamento iWof - ${mockTemplateData.subfolderName} - ${mockTemplateData.currentMonth}/${mockTemplateData.currentYear}`,
            html: htmlContent,
            attachments: [] // Em produção: stream de binários do Google Drive
        };

        /*
        const result = await transporter.sendMail(mailOptions);
        console.log(`Email enviado.MessageId: ${ result.messageId }`);
        */
        console.log(`E - mail simulado enviado para ${mailOptions.to} `);

        return NextResponse.json({ success: true, message: "E-mails disparados com sucesso (simulado)" });

    } catch (error: any) {
        console.error("Erro no API /faturamento/disparar-emails:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
