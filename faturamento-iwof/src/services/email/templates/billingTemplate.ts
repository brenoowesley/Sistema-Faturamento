export interface BillingTemplateData {
  clienteNome: string;
  cicloNome: string;
  mes: string;
  ano: string;
}

/**
 * Template de E-mail de Faturamento iWof Modernizado
 * @param data Dados dinâmicos para o template (sem valores financeiros)
 * @returns HTML string pronta para envio
 */
export function getBillingTemplate(data: BillingTemplateData) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Faturamento iWof</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f4f7f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
    .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05); border: 1px solid #e9ecef; overflow: hidden; }
    .header { background-color: #1c5d99; text-align: center; padding: 20px; }
    .header img { max-width: 120px; height: auto; }
    .content { padding: 30px; }
    .content h2 { font-size: 26px; color: #133b5c; margin-bottom: 20px; text-align: center; font-weight: 600; }
    .content p { font-size: 16px; line-height: 1.7; color: #34495e; margin: 0 0 15px; }
    .content strong { color: #1c5d99; font-weight: 600; }
    .highlight { background-color: #d6eaf8; border-left: 5px solid #1c5d99; padding: 20px; margin: 25px 0; border-radius: 8px; }
    .highlight p { margin: 0; font-weight: 500; color: #154360; }
    .whatsapp-button { display: inline-block; background-color: #25D366; color: #ffffff !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; text-align: center; margin-top: 20px; transition: all 0.3s ease; box-shadow: 0 2px 5px rgba(0,0,0,0.15); }
    .whatsapp-button:hover { background-color: #1EBE57; transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.2); }
    .whatsapp-button img { width: 20px; vertical-align: middle; margin-right: 10px; }
    .contact-info { margin-top: 30px; }
    .contact-info p { margin-bottom: 5px; }
    .footer { text-align: center; font-size: 12px; color: #868e96; padding: 0 30px 30px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://assets.unlayer.com/projects/261331/1734830295084-992622.png?w=256px" alt="iWof Logo">
    </div>
    <div class="content">
      <h2>Sua fatura iWof chegou!</h2>
      <p>Olá,</p>
      <p>Tudo pronto! A fatura do seu ciclo <strong>${data.cicloNome}</strong>, referente a <strong>${data.clienteNome}</strong> de <strong>${data.mes}/${data.ano}</strong>, já está disponível nos anexos deste e-mail.</p>
      <div class="highlight">
        <p><strong>Sua atenção é importante!</strong> Uma rápida revisão garante que tudo está correto com seus lançamentos.</p>
      </div>
      <p>Ficou com alguma dúvida ou notou algo diferente? Nossa equipe está pronta para ajudar. É só chamar!</p>
      <div class="contact-info">
        <p>Um abraço,</p>
        <p><strong>Equipe iWof</strong></p>
      </div>
      <a href="https://wa.me/558486987507" class="whatsapp-button">
        <img src="https://img.icons8.com/m_outlined/512/FFFFFF/whatsapp.png" alt="WhatsApp Logo">
        Fale conosco no WhatsApp
      </a>
    </div>
    <div class="footer">
      <p>&copy; ${data.ano} iWof. Todos os direitos reservados.</p>
      <p>Você recebeu este e-mail como parte do seu contrato de serviços.</p>
    </div>
  </div>
</body>
</html>`;
}
