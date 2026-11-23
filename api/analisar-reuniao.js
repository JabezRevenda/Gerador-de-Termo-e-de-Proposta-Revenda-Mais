// Lê a transcrição de uma reunião de vendas com IA e devolve a proposta + a ficha do lead (CRM).
// Roda na Vercel: a chave fica só nas variáveis de ambiente do projeto, nunca no navegador.
//   OPENAI_API_KEY     → usa a OpenAI (modelo em OPENAI_MODEL, padrão gpt-5.5)
//   ANTHROPIC_API_KEY  → usa o Claude, da Anthropic
// Com as duas configuradas, vale IA_PROVEDOR ("openai" ou "anthropic"); sem ela, a OpenAI.
// As instruções e o formato da resposta vêm da tela (index.html), que monta o catálogo a
// partir das mesmas tabelas de preço da proposta.
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const MODELO_OPENAI = process.env.OPENAI_MODEL || 'gpt-5.5';
const MODELO_ANTHROPIC = 'claude-opus-5-5';
const LIMITE_TRANSCRICAO = 400000;   // caracteres (~3 h de reunião)
const LIMITE_INSTRUCOES = 40000;
const LIMITE_SCHEMA = 20000;

class ErroIA extends Error {
  constructor(status, mensagem, codigo) { super(mensagem); this.status = status; this.codigo = codigo; }
}

function resposta(status, corpo) {
  return Response.json(corpo, { status: status });
}

function provedor() {
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

// Erros das duas APIs viram uma mensagem em português para a tela
function traduzirErro(e) {
  if (e instanceof ErroIA) return resposta(e.status, { codigo: e.codigo, erro: e.message });
  if (e instanceof SyntaxError) return resposta(502, { erro: 'A resposta da IA veio fora do formato. Tente de novo.' });
  const daApi = e instanceof OpenAI.APIError || e instanceof Anthropic.APIError;
  if (!daApi) { console.error(e); return resposta(500, { erro: 'Não deu para analisar a reunião.' }); }
  if (e instanceof OpenAI.APIConnectionError || e instanceof Anthropic.APIConnectionError) {
    return resposta(502, { erro: 'Sem conexão com a IA agora. Tente de novo em instantes.' });
  }
  if (e.status === 401 || e.status === 403) {
    return resposta(500, { codigo: 'chave_invalida', erro: 'A chave da IA configurada na Vercel é inválida ou não tem permissão.' });
  }
  if (e.status === 429) {
    const semCredito = /quota|credit|billing/i.test(String(e.message));
    return resposta(429, { erro: semCredito
      ? 'A conta da IA está sem créditos. Adicione saldo no painel da OpenAI/Anthropic.'
      : 'Limite de uso da IA atingido. Espere um minuto e tente de novo.' });
  }
  if (e.status === 400 || e.status === 404) return resposta(502, { erro: 'A IA recusou o pedido: ' + e.message });
  return resposta(502, { erro: 'A IA está instável agora. Tente de novo em instantes.' });
}

export async function POST(request) {
  const qual = provedor();
  if (!qual) {
    return resposta(503, { codigo: 'sem_chave', erro: 'A IA ainda não está ligada: falta a chave (OPENAI_API_KEY ou ANTHROPIC_API_KEY) nas variáveis de ambiente da Vercel.' });
  }

  // Só o próprio site chama esta função
  const origem = request.headers.get('origin');
  if (origem) {
    let hostOrigem = '';
    try { hostOrigem = new URL(origem).host; } catch (e) { /* origem inválida */ }
    if (hostOrigem !== request.headers.get('host')) return resposta(403, { erro: 'Origem não permitida.' });
  }

  let corpo;
  try { corpo = await request.json(); } catch (e) { return resposta(400, { erro: 'Pedido inválido.' }); }
  const transcricao = typeof corpo.transcricao === 'string' ? corpo.transcricao.trim() : '';
  const instrucoes = typeof corpo.instrucoes === 'string' ? corpo.instrucoes : '';
  const schema = corpo.schema;
  if (transcricao.length < 80) return resposta(400, { erro: 'A transcrição está vazia ou curta demais.' });
  if (transcricao.length > LIMITE_TRANSCRICAO) return resposta(413, { erro: 'A transcrição é grande demais. Mande só a reunião (até ~3 horas).' });
  if (!instrucoes || instrucoes.length > LIMITE_INSTRUCOES) return resposta(400, { erro: 'Instruções inválidas.' });
  if (!schema || typeof schema !== 'object' || JSON.stringify(schema).length > LIMITE_SCHEMA) return resposta(400, { erro: 'Formato de resposta inválido.' });

  try {
    const texto = qual === 'openai'
      ? await analisarOpenAI(instrucoes, schema, transcricao)
      : await analisarAnthropic(instrucoes, schema, transcricao);
    return resposta(200, { resultado: JSON.parse(texto), provedor: qual });
  } catch (e) {
    return traduzirErro(e);
  }
}
