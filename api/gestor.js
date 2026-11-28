// Painel do gestor: lê o Controle de todos os vendedores (renovações, calculadora e reuniões com feedback).
// Acesso com usuário e senha definidos nas variáveis da Vercel: GESTOR_USUARIO e GESTOR_SENHA.
// Depois de entrar, o navegador recebe uma chave assinada que vale 12 horas.
import { list, get } from '@vercel/blob';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { listarReunioes, processar, lerReuniao } from './_teams.js';

export const blob = { list, get };   // trocado por um falso no teste (testes/gestor.test.js)

const VALIDADE = 12 * 60 * 60 * 1000;
const REUNIOES_POR_VENDEDOR = 50;   // as mais recentes; a resposta da Vercel tem limite de tamanho

function resposta(status, corpo) {
  return Response.json(corpo, { status: status });
}
function igual(a, b) {   // compara sem vazar pelo tempo de resposta
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}
function segredo() {
  return 'gestor:' + process.env.GESTOR_USUARIO + ':' + process.env.GESTOR_SENHA;   // trocar a senha derruba as chaves antigas
}
function assinar(exp) {
  return createHmac('sha256', segredo()).update(String(exp)).digest('hex');
}
function chaveValida(chave) {
  const [exp, sig] = String(chave || '').split('.');
  return Number(exp) > Date.now() && !!sig && igual(sig, assinar(exp));
}

async function lerTodos() {
  const vendedores = [];
  let cursor;
  do {
    const pg = await blob.list({ prefix: 'controle/', cursor: cursor });
    for (const b of pg.blobs) {
      const r = await blob.get(b.pathname, { access: 'private', useCache: false });
      if (!r || r.statusCode !== 200) continue;
      const arq = JSON.parse(await new Response(r.stream).text());
      const dados = arq.dados || {};
      // Sem o PIN (sal e hash) e sem o texto das fichas: o gestor vê os números e os feedbacks
      vendedores.push({
        nome: arq.nome,
        meses: dados.meses || {},
        reunioes: (dados.reunioes || []).slice(0, REUNIOES_POR_VENDEDOR).map(function (x) {
          return { id: x.id, data: x.data, cliente: x.cliente, contato: x.contato, feedback: x.feedback };
        })
      });
    }
    cursor = pg.hasMore ? pg.cursor : undefined;
  } while (cursor);
  return vendedores.sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR'); });
}

export async function POST(request) {
  const origem = request.headers.get('origin');
  if (origem) {
    let hostOrigem = '';
    try { hostOrigem = new URL(origem).host; } catch (e) { /* origem inválida */ }
    if (hostOrigem !== request.headers.get('host')) return resposta(403, { erro: 'Origem não permitida.' });
  }
  if (!process.env.GESTOR_USUARIO || !process.env.GESTOR_SENHA) {
    return resposta(503, { erro: 'O painel ainda não foi configurado: crie GESTOR_USUARIO e GESTOR_SENHA nas variáveis da Vercel.' });
  }
  let corpo;
  try { corpo = await request.json(); } catch (e) { return resposta(400, { erro: 'Pedido inválido.' }); }

  if (corpo.acao === 'entrar') {
    const ok = igual(String(corpo.usuario || '').trim().toLowerCase(), process.env.GESTOR_USUARIO.trim().toLowerCase()) &&
      igual(String(corpo.senha || ''), process.env.GESTOR_SENHA);
    if (!ok) {
      // ponytail: só atrasa tentativas em sequência; sem banco não há bloqueio por número de erros. Use uma senha forte.
      await new Promise(function (fim) { setTimeout(fim, 800); });
      return resposta(401, { erro: 'Usuário ou senha incorretos.' });
    }
    const exp = Date.now() + VALIDADE;
    return resposta(200, { chave: exp + '.' + assinar(exp), expira: exp });
  }

  if (corpo.acao === 'dados') {
    if (!chaveValida(corpo.chave)) return resposta(401, { erro: 'Sessão expirada. Entre de novo.' });
    try {
      const [vendedores, teams] = await Promise.all([lerTodos(), listarReunioes()]);
      return resposta(200, { vendedores: vendedores, teams: teams });
    } catch (e) {
      console.error(e);
      return resposta(502, { erro: 'Não consegui ler os dados agora. Tente de novo.' });
    }
  }
  // Reunião do Teams com erro: analisa de novo (ou só entrega, se a IA já leu)
  if (corpo.acao === 'reprocessar') {
    if (!chaveValida(corpo.chave)) return resposta(401, { erro: 'Sessão expirada. Entre de novo.' });
    const m = await lerReuniao(corpo.id);
    if (!m || !(m.transcricao || m.resultado)) return resposta(404, { erro: 'Essa reunião não tem transcrição guardada para tentar de novo.' });
    waitUntil(processar(m.id).catch(function (e) { console.error(e); }));
    return resposta(202, { ok: true });
  }
  return resposta(400, { erro: 'Ação inválida.' });
}
