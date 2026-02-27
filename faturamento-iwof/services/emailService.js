const nodemailer = require('nodemailer');
const ejs = require('ejs');
const path = require('path');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com', // Ajuste conforme providor (gmail, office365 etc)
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_FINANCEIRO_USER,
        pass: process.env.EMAIL_FINANCEIRO_PASS,
    }
});

async function enviarFatura(to, cc, templateDados, anexos) {
    try {
        // templateDados: { cicloFolder, subfolderName, currentMonth, currentYear }
        const templatePath = path.join(__dirname, '../views/emails/fatura-mail.ejs');
        const htmlContent = await ejs.renderFile(templatePath, templateDados);

        // Prepara anexos do Nodemailer a partir de buffers
        // anexos é um array no formato: [{ filename: 'boleto.pdf', content: buffer }]
        const mailOptions = {
            from: `"Financeiro iWof" <${process.env.EMAIL_FINANCEIRO_USER}>`,
            to: to,
            cc: cc,
            subject: `Faturamento iWof - ${templateDados.subfolderName} - ${templateDados.currentMonth}/${templateDados.currentYear}`,
            html: htmlContent,
            attachments: anexos
        };

        const result = await transporter.sendMail(mailOptions);
        console.log(`Email enviado para ${to} - MessageId: ${result.messageId}`);
        return true;
    } catch (error) {
        console.error('Erro ao enviar e-mail de fatura:', error);
        throw error;
    }
}

module.exports = {
    enviarFatura
};
