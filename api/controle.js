// Guarda o controle de cada vendedor (renovações do mês + calculadora) no Vercel Blob,
// um arquivo .json por pessoa, privado. Acesso por nome + PIN: o primeiro salvamento define o PIN.
// O Blob store precisa estar conectado ao projeto na Vercel (Storage → Blob, acesso Private).
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const blob = { get, put };   // trocado por um falso no teste (testes/controle.test.js)

const LIMITE = 300000;   // bytes por vendedor; anos de histórico cabem com folga

function resposta(status, corpo) {
  return Response.json(corpo, { status: status });
}

function slug(nome) {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function hashPin(pin, sal) {
  return scryptSync(pin, sal, 32).toString('hex');
}

function pinConfere(pin, arq) {
  const a = Buffer.from(hashPin(pin, arq.sal), 'hex');
  const b = Buffer.from(arq.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

async function lerArquivo(caminho) {
  const r = await blob.get(caminho, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return { arq: JSON.parse(await new Response(r.stream).text()), etag: r.blob.etag };
}

export async function POST(request) {
  const origem = request.headers.get('origin');
  if (origem) {
    let hostOrigem = '';
    try { hostOrigem = new URL(origem).host; } catch (e) { /* origem inválida */ }
    if (hostOrigem !== request.headers.get('host')) return resposta(403, { erro: 'Origem não permitida.' });
  }

  const texto = await request.text();
  if (texto.length > LIMITE) return resposta(413, { erro: 'Dados grandes demais.' });
  let corpo;
  try { corpo = JSON.parse(texto); } catch (e) { return resposta(400, { erro: 'Pedido inválido.' }); }

  const nome = typeof corpo.nome === 'string' ? corpo.nome.trim().replace(/\s+/g, ' ') : '';
  const pin = typeof corpo.pin === 'string' ? corpo.pin : '';
  const chave = slug(nome);
  if (chave.length < 2 || nome.length > 60) return resposta(400, { erro: 'Informe seu nome.' });
  // ponytail: PIN numérico sem limite de tentativas (não há banco para contar erros). Serve para
  // dados internos de baixo risco; se precisar de mais, trocar por login de verdade.
  if (!/^\d{4,8}$/.test(pin)) return resposta(400, { erro: 'O PIN tem de 4 a 8 números.' });

  const caminho = 'controle/' + chave + '.json';
  let atual;
  try { atual = await lerArquivo(caminho); } catch (e) {
    console.error(e);
    return resposta(502, { erro: 'Não consegui ler os dados agora. Tente de novo.' });
  }
  if (atual && !pinConfere(pin, atual.arq)) {
    return resposta(401, { erro: 'PIN errado para "' + atual.arq.nome + '". Se não for você, use nome e sobrenome.' });
  }

  if (corpo.acao === 'ler') {
    return resposta(200, { dados: atual ? atual.arq.dados : {}, etag: atual ? atual.etag : null, nome: atual ? atual.arq.nome : nome });
  }

  if (corpo.acao !== 'salvar') return resposta(400, { erro: 'Ação inválida.' });
  if (!corpo.dados || typeof corpo.dados !== 'object' || Array.isArray(corpo.dados)) return resposta(400, { erro: 'Dados inválidos.' });
  // Salvar em cima de uma versão antiga apagaria o que foi feito em outro aparelho
  if ((atual ? atual.etag : null) !== (corpo.etag || null)) {
    return resposta(409, { erro: 'Os dados mudaram em outro aparelho.' });
  }

  const sal = atual ? atual.arq.sal : randomBytes(16).toString('hex');
  const arq = { nome: atual ? atual.arq.nome : nome, sal: sal, hash: atual ? atual.arq.hash : hashPin(pin, sal), dados: corpo.dados };
  try {
    const r = await blob.put(caminho, JSON.stringify(arq), {
      access: 'private', contentType: 'application/json', addRandomSuffix: false,
      allowOverwrite: !!atual, ifMatch: atual ? atual.etag : undefined
    });
    return resposta(200, { etag: r.etag });
  } catch (e) {
    // Precondição falhou, ou outro aparelho criou o arquivo primeiro
    const criadoAntes = !atual && await lerArquivo(caminho).catch(function () { return null; });
    if (e instanceof BlobPreconditionFailedError || criadoAntes) return resposta(409, { erro: 'Os dados mudaram em outro aparelho.' });
    console.error(e);
    return resposta(502, { erro: 'Não consegui salvar agora. Tente de novo.' });
  }
}
