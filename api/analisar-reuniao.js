// Lê a transcrição de uma reunião de vendas com o Claude e devolve a proposta + a ficha do lead (CRM).
// Roda na Vercel: a chave fica só na variável de ambiente ANTHROPIC_API_KEY do projeto,
// nunca no navegador. As instruções e o formato da resposta vêm da tela (index.html),
// que monta o catálogo a partir das mesmas tabelas de preço da proposta.
import Anthropic from '@anthropic-ai/sdk';

const MODELO = 'claude-opus-5-5';
const LIMITE_TRANSCRICAO = 400000;   // caracteres (~3 h de reunião)
const LIMITE_INSTRUCOES = 40000;
const LIMITE_SCHEMA = 20000;

function resposta(status, corpo) {
  return Response.json(corpo, { status: status });
}

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return resposta(503, { codigo: 'sem_chave', erro: 'A IA ainda não está ligada: falta a chave da Anthropic (ANTHROPIC_API_KEY) nas variáveis de ambiente da Vercel.' });
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

  const client = new Anthropic();
  try {
    const stream = client.beta.messages.stream({
      model: MODELO,
      max_tokens: 32000,
      // Se o modelo recusar por segurança, a própria API tenta outro modelo
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: schema } },
      system: instrucoes,
      messages: [{ role: 'user', content: 'Transcrição da reunião:\n\n<transcricao>\n' + transcricao + '\n</transcricao>' }]
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') {
      return resposta(422, { codigo: 'recusa', erro: 'A IA não quis analisar esta transcrição. Confira se o arquivo é mesmo a reunião.' });
    }
    if (msg.stop_reason === 'max_tokens') {
      return resposta(502, { erro: 'A resposta da IA ficou incompleta. Tente de novo.' });
    }
    const texto = msg.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
    return resposta(200, { resultado: JSON.parse(texto) });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return resposta(500, { codigo: 'chave_invalida', erro: 'A chave da Anthropic configurada na Vercel é inválida ou não tem permissão.' });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return resposta(429, { erro: 'Limite de uso da IA atingido. Espere um minuto e tente de novo.' });
    }
    if (e instanceof Anthropic.BadRequestError) {
      return resposta(502, { erro: 'A Anthropic recusou o pedido: ' + e.message });
    }
    if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.InternalServerError) {
      return resposta(502, { erro: 'A Anthropic está instável agora. Tente de novo em instantes.' });
    }
    if (e instanceof SyntaxError) {
      return resposta(502, { erro: 'A resposta da IA veio fora do formato. Tente de novo.' });
    }
    console.error(e);
    return resposta(500, { erro: 'Não deu para analisar a reunião.' });
  }
}
