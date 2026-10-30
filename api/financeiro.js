// Recebe o envio da etapa "Enviar ao Financeiro" e repassa ao fluxo do Power Automate,
// que manda o e-mail ao financeiro com o termo assinado anexo.
// O link do fluxo fica só na variável de ambiente FINANCEIRO_FLOW_URL do Vercel:
// o repositório é público, e com o link qualquer pessoa conseguiria disparar e-mails.
//
// Gatilho em "Qualquer usuário no meu locatário": a função se identifica com um app do
// Entra ID (FINANCEIRO_TENANT_ID, FINANCEIRO_CLIENT_ID, FINANCEIRO_CLIENT_SECRET) e manda
// o token junto. Sem essas variáveis, chama o link direto (gatilho "Qualquer pessoa").
const OBRIGATORIOS = ['idLoja', 'loja', 'assunto', 'corpoHtml', 'arquivoNome', 'arquivoBase64'];
// O público do token precisa bater exatamente com o do Power Automate, inclusive a barra dupla
const ESCOPO_FLOW = 'https://service.flow.microsoft.com//.default';

let tokenEmCache = null;   // { valor, expiraEm } — reaproveitado enquanto a função estiver quente

async function tokenDoApp() {
  if (tokenEmCache && tokenEmCache.expiraEm > Date.now() + 60000) return tokenEmCache.valor;
  const r = await fetch('https://login.microsoftonline.com/' + encodeURIComponent(process.env.FINANCEIRO_TENANT_ID) + '/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.FINANCEIRO_CLIENT_ID,
      client_secret: process.env.FINANCEIRO_CLIENT_SECRET,
      scope: ESCOPO_FLOW
    }).toString()
  });
  const j = await r.json().catch(function () { return {}; });
  if (!r.ok || !j.access_token) {
    // error/error_description dizem o motivo (ex.: segredo vencido) e não contêm o segredo
    console.error('Entra ID recusou o token: ' + (j.error || r.status) + ' ' + String(j.error_description || '').slice(0, 300));
    throw new Error('login');
  }
  tokenEmCache = { valor: j.access_token, expiraEm: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return tokenEmCache.valor;
}

module.exports = async function (req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Use POST.' });
    return;
  }

  const url = process.env.FINANCEIRO_FLOW_URL;
  if (!url) {
    res.status(503).json({ erro: 'O envio ao financeiro ainda não foi configurado no Vercel (variável FINANCEIRO_FLOW_URL).' });
    return;
  }

  const dados = req.body || {};
  const falta = OBRIGATORIOS.filter(function (c) { return !dados[c]; });
  if (falta.length) {
    res.status(400).json({ erro: 'Faltam dados no envio: ' + falta.join(', ') + '.' });
    return;
  }

  const comApp = !!(process.env.FINANCEIRO_TENANT_ID && process.env.FINANCEIRO_CLIENT_ID && process.env.FINANCEIRO_CLIENT_SECRET);
  const headers = { 'Content-Type': 'application/json' };
  if (comApp) {
    try {
      headers.Authorization = 'Bearer ' + await tokenDoApp();
    } catch (e) {
      res.status(502).json({ erro: 'A Microsoft não liberou o acesso do app. Confira FINANCEIRO_TENANT_ID, FINANCEIRO_CLIENT_ID e FINANCEIRO_CLIENT_SECRET no Vercel (o segredo pode ter vencido).' });
      return;
    }
  }

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(dados)
    });
    if (!r.ok) {
      // O corpo do erro diz o motivo (ex.: exige login) e não contém o link do fluxo
      const motivo = (await r.text().catch(function () { return ''; })).slice(0, 500);
      console.error('Power Automate respondeu ' + r.status + ': ' + motivo);
      const dica = r.status !== 401 && r.status !== 403 ? ''
        : comApp
          ? ' O fluxo não aceitou o app: confira se o gatilho está em "Qualquer usuário no meu locatário" e se o app é do mesmo locatário.'
          : ' O fluxo exige login: cadastre FINANCEIRO_TENANT_ID, FINANCEIRO_CLIENT_ID e FINANCEIRO_CLIENT_SECRET no Vercel.';
      res.status(502).json({ erro: 'O fluxo do Power Automate recusou o envio (erro ' + r.status + ').' + dica });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ erro: 'Não foi possível falar com o fluxo do Power Automate.' });
  }
};
