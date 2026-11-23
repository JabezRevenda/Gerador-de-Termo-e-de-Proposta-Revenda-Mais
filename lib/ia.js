// Serviço de IA usado pelas funções da Vercel (aba CRM e webhook do Teams).
// A chave fica só nas variáveis de ambiente do projeto, nunca no navegador:
//   OPENAI_API_KEY     → OpenAI (modelo em OPENAI_MODEL, padrão gpt-5.5)
//   ANTHROPIC_API_KEY  → Claude, da Anthropic (modelo em ANTHROPIC_MODEL, padrão claude-opus-5-5)
// Com as duas configuradas, vale IA_PROVEDOR ("openai" ou "anthropic"); sem ela, a OpenAI.
// Quem chama passa as instruções, o JSON Schema da resposta e o conteúdo; volta o objeto já
// conferido contra o schema (structured outputs + validação aqui).
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { validarSchema } from './esquema.js';

export class ErroIA extends Error {
  constructor(status, mensagem, codigo) { super(mensagem); this.status = status; this.codigo = codigo; }
}

export function provedorIA() {
  const temOpenAI = !!process.env.OPENAI_API_KEY;
  const temAnthropic = !!process.env.ANTHROPIC_API_KEY;
  if (temOpenAI && temAnthropic) return process.env.IA_PROVEDOR === 'anthropic' ? 'anthropic' : 'openai';
  return temOpenAI ? 'openai' : temAnthropic ? 'anthropic' : null;
}

// OpenAI — Responses API com Structured Outputs
async function viaOpenAI(instrucoes, schema, nome, conteudo) {
  const client = new OpenAI();
  const r = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5.5',
    instructions: instrucoes,
    input: conteudo,
    text: { format: { type: 'json_schema', name: nome, schema: schema, strict: true } }
  });
  const recusou = (r.output || []).some(function (item) {
    return item.type === 'message' && (item.content || []).some(function (c) { return c.type === 'refusal'; });
  });
  if (recusou) throw new ErroIA(422, 'A IA não quis analisar esta transcrição. Confira se o conteúdo é mesmo a reunião.', 'recusa');
  if (r.status === 'incomplete') throw new ErroIA(502, 'A resposta da IA ficou incompleta. Tente de novo.', 'incompleta');
  return r.output_text;
}

// Anthropic (Claude) — structured outputs + fallback do lado da API se o modelo recusar
async function viaAnthropic(instrucoes, schema, conteudo) {
  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: schema } },
    system: instrucoes,
    messages: [{ role: 'user', content: conteudo }]
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new ErroIA(422, 'A IA não quis analisar esta transcrição. Confira se o conteúdo é mesmo a reunião.', 'recusa');
  if (msg.stop_reason === 'max_tokens') throw new ErroIA(502, 'A resposta da IA ficou incompleta. Tente de novo.', 'incompleta');
  return msg.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
}

/**
 * Pede à IA um JSON no formato `schema` e devolve o objeto validado.
 * @param {{ instrucoes: string, schema: object, nome: string, conteudo: string }} p
 */
export async function gerarJson(p) {
  const qual = provedorIA();
  if (!qual) throw new ErroIA(503, 'A IA ainda não está ligada: falta a chave (OPENAI_API_KEY ou ANTHROPIC_API_KEY) nas variáveis de ambiente da Vercel.', 'sem_chave');
  const texto = qual === 'openai'
    ? await viaOpenAI(p.instrucoes, p.schema, p.nome, p.conteudo)
    : await viaAnthropic(p.instrucoes, p.schema, p.conteudo);
  let dados;
  try { dados = JSON.parse(texto); } catch (e) { throw new ErroIA(502, 'A resposta da IA veio fora do formato. Tente de novo.', 'formato'); }
  const erros = validarSchema(p.schema, dados);
  if (erros.length) throw new ErroIA(502, 'A resposta da IA veio fora do formato esperado (' + erros.slice(0, 3).join('; ') + ').', 'formato');
  return dados;
}

// Erros das duas APIs viram { status, codigo, erro } em português, sem detalhes internos
export function traduzirErroIA(e) {
  if (e instanceof ErroIA) return { status: e.status, codigo: e.codigo, erro: e.message };
  const daApi = e instanceof OpenAI.APIError || e instanceof Anthropic.APIError;
  if (!daApi) return { status: 500, codigo: 'interno', erro: 'Não deu para analisar a reunião.' };
  if (e instanceof OpenAI.APIConnectionError || e instanceof Anthropic.APIConnectionError) {
    return { status: 502, codigo: 'conexao', erro: 'Sem conexão com a IA agora. Tente de novo em instantes.' };
  }
  if (e.status === 401 || e.status === 403) {
    return { status: 500, codigo: 'chave_invalida', erro: 'A chave da IA configurada na Vercel é inválida ou não tem permissão.' };
  }
  if (e.status === 429) {
    const semCredito = /quota|credit|billing/i.test(String(e.message));
    return { status: 429, codigo: semCredito ? 'sem_credito' : 'limite', erro: semCredito
      ? 'A conta da IA está sem créditos. Adicione saldo no painel da OpenAI/Anthropic.'
      : 'Limite de uso da IA atingido. Espere um minuto e tente de novo.' };
  }
  if (e.status === 400 || e.status === 404) return { status: 502, codigo: 'pedido_recusado', erro: 'A IA recusou o pedido: ' + e.message };
  return { status: 502, codigo: 'instavel', erro: 'A IA está instável agora. Tente de novo em instantes.' };
}
