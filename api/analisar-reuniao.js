// Aba CRM do site: lê a transcrição colada/subida na tela e devolve a proposta + a ficha do lead.
// A IA (OpenAI ou Anthropic) fica em lib/ia.js; a chave só nas variáveis de ambiente da Vercel.
// As instruções e o formato da resposta vêm da tela (index.html), que monta o catálogo a
// partir das mesmas tabelas de preço da proposta.
import { gerarJson, traduzirErroIA, provedorIA } from '../lib/ia.js';

const LIMITE_TRANSCRICAO = 400000;   // caracteres (~3 h de reunião)
const LIMITE_INSTRUCOES = 40000;
const LIMITE_SCHEMA = 20000;

function resposta(status, corpo) {
  return Response.json(corpo, { status: status });
}

export async function POST(request) {
  if (!provedorIA()) {
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
    const resultado = await gerarJson({
      instrucoes: instrucoes,
      schema: schema,
      nome: 'proposta_e_ficha_crm',
      conteudo: 'Transcrição da reunião:\n\n<transcricao>\n' + transcricao + '\n</transcricao>'
    });
    return resposta(200, { resultado: resultado, provedor: provedorIA() });
  } catch (e) {
    const t = traduzirErroIA(e);
    if (t.codigo === 'interno') console.error('analisar-reuniao: erro inesperado', e && e.name);
    return resposta(t.status, { codigo: t.codigo, erro: t.erro });
  }
}
