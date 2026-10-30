// Recebe o envio da etapa "Enviar ao Financeiro" e manda o e-mail, com o termo assinado anexo,
// pelo Gmail do gerador para o Outlook de EMAIL_DESTINO. Lá, um fluxo do Power Automate
// (conector do Outlook, Standard) reenvia ao financeiro pela conta da pessoa e apaga o original.
//
// Variáveis no Vercel: GMAIL_USUARIO, GMAIL_SENHA_APP (senha de app do Google, não a senha
// normal) e EMAIL_DESTINO. O destino é fixo: a função não manda e-mail para outro endereço.
const nodemailer = require('nodemailer');

const OBRIGATORIOS = ['idLoja', 'loja', 'assunto', 'corpoHtml', 'arquivoNome', 'arquivoBase64'];

// Valores colados no Vercel às vezes vêm com espaço, quebra de linha ou aspas
function limpar(v) {
  return String(v || '').trim().replace(/^["']+|["']+$/g, '').trim();
}
function credenciais() {
  return {
    usuario: limpar(process.env.GMAIL_USUARIO),
    senha: limpar(process.env.GMAIL_SENHA_APP).replace(/\s+/g, ''),   // o Google mostra em blocos com espaço
    destino: limpar(process.env.EMAIL_DESTINO)
  };
}
function configurado() {
  const c = credenciais();
  return !!(c.usuario && c.senha && c.destino);
}

module.exports = async function (req, res) {
  // O gerador pergunta se o envio automático está ligado, para mostrar "Enviar" ou "Abrir no Outlook"
  if (req.method === 'GET') {
    res.status(200).json({ automatico: configurado() });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Use POST.' });
    return;
  }
  if (!configurado()) {
    res.status(503).json({ erro: 'O envio automático ainda não foi configurado no Vercel (GMAIL_USUARIO, GMAIL_SENHA_APP e EMAIL_DESTINO).' });
    return;
  }

  const dados = req.body || {};
  const falta = OBRIGATORIOS.filter(function (c) { return !dados[c]; });
  if (falta.length) {
    res.status(400).json({ erro: 'Faltam dados no envio: ' + falta.join(', ') + '.' });
    return;
  }

  const c = credenciais();
  try {
    const transporte = nodemailer.createTransport({ service: 'gmail', auth: { user: c.usuario, pass: c.senha } });
    await transporte.sendMail({
      from: { name: 'Gerador Revenda Mais', address: c.usuario },
      to: c.destino,
      subject: dados.assunto,
      html: dados.corpoHtml,
      attachments: [{
        filename: dados.arquivoNome,
        content: dados.arquivoBase64,
        encoding: 'base64',
        contentType: dados.arquivoTipo || undefined
      }]
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    // code/responseCode dizem o motivo (ex.: EAUTH = senha recusada) e não contêm a senha
    console.error('Gmail não enviou: ' + (e.code || '') + ' ' + (e.responseCode || '') + ' ' + String(e.response || e.message).slice(0, 300));
    // Pistas para conferir as variáveis sem mostrar nenhuma delas
    if (e.code === 'EAUTH') {
      console.error('Conferência: usuário é um endereço @gmail.com completo? ' + (/^[^@\s]+@gmail\.com$/i.test(c.usuario) ? 'sim' : 'NÃO') +
        ' | senha tem 16 letras (senha de app)? ' + (/^[a-z]{16}$/i.test(c.senha) ? 'sim' : 'NÃO (' + c.senha.length + ' caracteres)'));
    }
    res.status(502).json({
      erro: 'O Gmail não conseguiu enviar.' + (e.code === 'EAUTH'
        ? ' Confira GMAIL_USUARIO e GMAIL_SENHA_APP no Vercel (use a senha de app do Google, não a senha normal).'
        : '')
    });
  }
};
