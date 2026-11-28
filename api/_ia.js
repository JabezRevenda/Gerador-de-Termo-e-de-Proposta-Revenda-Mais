// Chamada à IA (OpenAI ou Claude), usada por api/analisar-reuniao.js (aba CRM) e pelo Teams
// (api/_teams.js). Arquivo com _ na frente: a Vercel não publica como rota.
//   OPENAI_API_KEY     → usa a OpenAI (modelo em OPENAI_MODEL, padrão gpt-5.5)
//   ANTHROPIC_API_KEY  → usa o Claude, da Anthropic
// Com as duas configuradas, vale IA_PROVEDOR ("openai" ou "anthropic"); sem ela, a OpenAI.
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const MODELO_OPENAI = process.env.OPENAI_MODEL || 'gpt-5.5';
const MODELO_ANTHROPIC = 'claude-opus-5-5';

export class ErroIA extends Error {
  constructor(status, mensagem, codigo) { super(mensagem); this.status = status; this.codigo = codigo; }
}

export function provedor() {
  const temOpenAI = !!process.env.OPENAI_API_KEY;
  const temAnthropic = !!process.env.ANTHROPIC_API_KEY;
  if (temOpenAI && temAnthropic) return process.env.IA_PROVEDOR === 'anthropic' ? 'anthropic' : 'openai';
  return temOpenAI ? 'openai' : temAnthropic ? 'anthropic' : null;
}

function mensagemUsuario(transcricao) {
  return 'Transcrição da reunião:\n\n<transcricao>\n' + transcricao + '\n</transcricao>';
}

// OpenAI — Responses API com Structured Outputs (o JSON volta exatamente no formato do schema)
async function analisarOpenAI(instrucoes, schema, transcricao) {
  const client = new OpenAI();
  const r = await client.responses.create({
    model: MODELO_OPENAI,
    instructions: instrucoes,
    input: mensagemUsuario(transcricao),
    text: { format: { type: 'json_schema', name: 'proposta_e_ficha_crm', schema: schema, strict: true } }
  });
  const recusou = (r.output || []).some(function (item) {
    return item.type === 'message' && (item.content || []).some(function (c) { return c.type === 'refusal'; });
  });
  if (recusou) throw new ErroIA(422, 'A IA não quis analisar esta transcrição. Confira se o arquivo é mesmo a reunião.', 'recusa');
  if (r.status === 'incomplete') throw new ErroIA(502, 'A resposta da IA ficou incompleta. Tente de novo.');
  return r.output_text;
}

// Anthropic (Claude) — structured outputs + fallback do lado da API se o modelo recusar
async function analisarAnthropic(instrucoes, schema, transcricao) {
  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: MODELO_ANTHROPIC,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: schema } },
    system: instrucoes,
    messages: [{ role: 'user', content: mensagemUsuario(transcricao) }]
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new ErroIA(422, 'A IA não quis analisar esta transcrição. Confira se o arquivo é mesmo a reunião.', 'recusa');
  if (msg.stop_reason === 'max_tokens') throw new ErroIA(502, 'A resposta da IA ficou incompleta. Tente de novo.');
  return msg.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
}

// Erros das duas APIs viram uma mensagem em português ({ status, erro, codigo })
function erro(status, corpo) { return Object.assign({ status: status }, corpo); }
export function traduzirErro(e) {
  if (e instanceof ErroIA) return erro(e.status, { codigo: e.codigo, erro: e.message });
  if (e instanceof SyntaxError) return erro(502, { erro: 'A resposta da IA veio fora do formato. Tente de novo.' });
  const daApi = e instanceof OpenAI.APIError || e instanceof Anthropic.APIError;
  if (!daApi) { console.error(e); return erro(500, { erro: 'Não deu para analisar a reunião.' }); }
  if (e instanceof OpenAI.APIConnectionError || e instanceof Anthropic.APIConnectionError) {
    return erro(502, { erro: 'Sem conexão com a IA agora. Tente de novo em instantes.' });
  }
  if (e.status === 401 || e.status === 403) {
    return erro(500, { codigo: 'chave_invalida', erro: 'A chave da IA configurada na Vercel é inválida ou não tem permissão.' });
  }
  if (e.status === 429) {
    const semCredito = /quota|credit|billing/i.test(String(e.message));
    return erro(429, { erro: semCredito
      ? 'A conta da IA está sem créditos. Adicione saldo no painel da OpenAI/Anthropic.'
      : 'Limite de uso da IA atingido. Espere um minuto e tente de novo.' });
  }
  if (e.status === 400 || e.status === 404) return erro(502, { erro: 'A IA recusou o pedido: ' + e.message });
  return erro(502, { erro: 'A IA está instável agora. Tente de novo em instantes.' });
}


// Analisa a transcrição e devolve o objeto no formato do schema
export async function analisar(instrucoes, schema, transcricao) {
  const qual = provedor();
  if (!qual) throw new ErroIA(503, 'A IA ainda não está ligada: falta a chave (OPENAI_API_KEY ou ANTHROPIC_API_KEY) nas variáveis de ambiente da Vercel.', 'sem_chave');
  const texto = qual === 'openai'
    ? await analisarOpenAI(instrucoes, schema, transcricao)
    : await analisarAnthropic(instrucoes, schema, transcricao);
  return { resultado: JSON.parse(texto), provedor: qual };
}
