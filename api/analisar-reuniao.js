// Lê a transcrição de uma reunião de vendas com IA e devolve a proposta + a ficha do lead (CRM).
// Roda na Vercel: a chave fica só nas variáveis de ambiente do projeto, nunca no navegador.
// As instruções e o formato da resposta vêm da tela (ia-pedido.js), que monta o catálogo a
// partir das mesmas tabelas de preço da proposta. A chamada à IA fica em api/_ia.js.
import { analisar, traduzirErro, provedor } from './_ia.js';

const LIMITE_TRANSCRICAO = 400000;   // caracteres (~3 h de reunião)
const LIMITE_INSTRUCOES = 40000;
const LIMITE_SCHEMA = 20000;

function resposta(status, corpo) {
  return Response.json(corpo, { status: status });
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
    return resposta(200, await analisar(instrucoes, schema, transcricao));
  } catch (e) {
    const t = traduzirErro(e);
    return resposta(t.status, { codigo: t.codigo, erro: t.erro });
  }
}
