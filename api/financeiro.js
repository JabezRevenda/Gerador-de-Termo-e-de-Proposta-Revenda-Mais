// Recebe o envio da etapa "Enviar ao Financeiro" e repassa ao fluxo do Power Automate,
// que manda o e-mail ao financeiro com o termo assinado anexo.
// O link do fluxo fica só na variável de ambiente FINANCEIRO_FLOW_URL do Vercel:
// o repositório é público, e com o link qualquer pessoa conseguiria disparar e-mails.
const OBRIGATORIOS = ['idLoja', 'loja', 'assunto', 'corpoHtml', 'arquivoNome', 'arquivoBase64'];

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

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });
    if (!r.ok) {
      // O corpo do erro diz o motivo (ex.: exige login) e não contém o link do fluxo
      const motivo = (await r.text().catch(function () { return ''; })).slice(0, 500);
      console.error('Power Automate respondeu ' + r.status + ': ' + motivo);
      const dica = r.status === 401 || r.status === 403
        ? ' No gatilho do fluxo, "Quem pode disparar" precisa estar como "Qualquer pessoa"; depois copie a URL de novo (ela termina com sig=...) e atualize FINANCEIRO_FLOW_URL no Vercel.'
        : '';
      res.status(502).json({ erro: 'O fluxo do Power Automate recusou o envio (erro ' + r.status + ').' + dica });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ erro: 'Não foi possível falar com o fluxo do Power Automate.' });
  }
};
