// Teste das reuniões do Teams (api/teams.js + api/_teams.js) com Blob e IA falsos. Rodar: node testes/teams.test.js
import assert from 'node:assert/strict';

process.env.TEAMS_CHAVE = 'chave-do-fluxo';
const { POST } = await import('../api/teams.js');
const T = await import('../api/_teams.js');

// Blob falso em memória (com ETag e ifMatch, como o de verdade)
const mem = new Map();
let n = 0;
T.blob.get = async function (c) {
  const v = mem.get(c);
  return v ? { statusCode: 200, stream: new Response(v.corpo).body, blob: { etag: v.etag } } : null;
};
T.blob.put = async function (c, corpo, op) {
  const v = mem.get(c);
  if (v && !op.allowOverwrite) throw new Error('já existe');
  if (op.ifMatch && (!v || v.etag !== op.ifMatch)) { const e = new Error('etag'); e.name = 'BlobPreconditionFailedError'; throw e; }
  mem.set(c, { corpo: corpo, etag: 'e' + (++n) });
  return { etag: 'e' + n };
};
T.blob.list = async function (op) {
  return { blobs: [...mem.keys()].filter(function (k) { return k.startsWith(op.prefix); }).map(function (k) { return { pathname: k }; }), hasMore: false };
};
let falhaIA = false;
T.ia.analisar = async function (instrucoes, schema, transcricao) {
  assert.ok(instrucoes.includes('SPIN') && schema.properties.feedback && transcricao.includes('Paulo'));   // mesmo pedido do hub
  if (falhaIA) throw Object.assign(new Error('x'), { status: 429, message: 'rate limit' });
  return { resultado: { lead: { empresa: 'Prime Veículos', contato: 'Paulo' }, crm: { dor_principal: 'Leads perdidos' }, proposta: {}, feedback: { nota: 7 } } };
};
const ler = function (c) { return JSON.parse(mem.get(c).corpo); };
async function chamar(corpo, chave) {
  const r = await POST(new Request('http://x/api/teams', { method: 'POST', body: JSON.stringify(corpo), headers: { 'x-hub-chave': chave === undefined ? 'chave-do-fluxo' : chave } }));
  return { status: r.status, json: await r.json() };
}
const transcricao = 'Vendedor: Bom dia, Paulo. Paulo: Bom dia. Vendedor: quantos carros vocês têm hoje? Paulo: uns trinta e cinco.';

// Chave e formato
assert.equal((await chamar({ evento: 'reuniao', id: 'a' }, 'errada')).status, 401);
assert.equal((await chamar({ evento: 'qualquer' })).status, 400);

// Vendedor com o e-mail no Controle
mem.set('controle/marina.json', { corpo: JSON.stringify({ nome: 'Marina', email: 'marina@revendamais.com.br', dados: { meses: {} } }), etag: 'e0' });

// 1) Gravou → transcrição → IA → entregue como nova
let r = await chamar({ evento: 'reuniao', id: 'R1', email: 'Marina@RevendaMais.com.br', titulo: 'Demo Prime' });
assert.equal(r.status, 202); assert.equal(ler('teams/R1.json').status, 'aguardando');
r = await chamar({ evento: 'transcricao', id: 'R1', transcricao: transcricao });
assert.equal(r.json.status, 'analisando');
await T.processar('R1');   // na Vercel roda pelo waitUntil
let m = ler('teams/R1.json');
assert.equal(m.status, 'pronta'); assert.equal(m.vendedor, 'Marina'); assert.equal(m.transcricao, undefined);
let item = ler('controle/marina.json').dados.reunioes[0];
assert.equal(item.id, 'teams-R1'); assert.equal(item.nova, true); assert.equal(item.cliente, 'Prime Veículos');
assert.ok(item.ficha.startsWith('Dor Principal\nLeads perdidos')); assert.equal(item.feedback.nota, 7);

// 2) E-mail sem vendedor → erro explicado; depois que ele entra no Controle, tentar de novo entrega sem chamar a IA de novo
await chamar({ evento: 'transcricao', id: 'R2', email: 'joao@revendamais.com.br', transcricao: transcricao });
await T.processar('R2');
m = ler('teams/R2.json');
assert.equal(m.status, 'erro'); assert.match(m.motivo, /joao@revendamais.com.br/); assert.ok(m.resultado);
mem.set('controle/joao.json', { corpo: JSON.stringify({ nome: 'João', email: 'joao@revendamais.com.br', dados: {} }), etag: 'e00' });
falhaIA = true;   // não pode precisar da IA
await T.processar('R2');
assert.equal(ler('teams/R2.json').status, 'pronta');
assert.equal(ler('controle/joao.json').dados.reunioes[0].id, 'teams-R2');
falhaIA = false;

// 3) A IA falhou → erro com o motivo, transcrição guardada para tentar de novo
falhaIA = true;
await chamar({ evento: 'transcricao', id: 'R3', email: 'marina@revendamais.com.br', transcricao: transcricao });
await T.processar('R3');
m = ler('teams/R3.json');
assert.equal(m.status, 'erro'); assert.match(m.motivo, /IA/); assert.ok(m.transcricao);
falhaIA = false;
await T.processar('R3');
assert.equal(ler('teams/R3.json').status, 'pronta');

// 4) O fluxo avisou falha / transcrição vazia
await chamar({ evento: 'erro', id: 'R4', email: 'marina@revendamais.com.br', motivo: 'transcrição não encontrada' });
assert.match(ler('teams/R4.json').motivo, /transcrição não encontrada/);
await chamar({ evento: 'transcricao', id: 'R5', transcricao: 'curta' });
assert.equal(ler('teams/R5.json').status, 'erro');

// 5) Gravou e a transcrição não chegou em 3 h → aparece no painel
await chamar({ evento: 'reuniao', id: 'R6', email: 'marina@revendamais.com.br', titulo: 'Sem transcrição' });
const antigo = ler('teams/R6.json'); antigo.atualizadoEm = antigo.criadoEm = new Date(Date.now() - 4 * 3600e3).toISOString();
mem.set('teams/R6.json', { corpo: JSON.stringify(antigo), etag: 'x' });
const lista = await T.listarReunioes();
const porId = Object.fromEntries(lista.map(function (x) { return [x.id, x]; }));
assert.equal(porId.R6.situacao, 'sem_transcricao');
assert.equal(porId.R1.situacao, 'pronta'); assert.equal(porId.R1.podeTentar, false);
assert.equal(porId.R4.podeTentar, false);   // sem transcrição guardada
assert.equal(JSON.stringify(lista).includes('trinta e cinco'), false);   // o painel não recebe transcrições

// A mesma reunião de novo substitui, não duplica
await chamar({ evento: 'transcricao', id: 'R1', email: 'marina@revendamais.com.br', transcricao: transcricao });
await T.processar('R1');
assert.equal(ler('controle/marina.json').dados.reunioes.filter(function (x) { return x.id === 'teams-R1'; }).length, 1);
console.log('ok: api/teams');
