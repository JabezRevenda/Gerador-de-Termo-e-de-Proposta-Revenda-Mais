// Teste do api/gestor.js com um Blob falso em memória. Rodar: node testes/gestor.test.js
import assert from 'node:assert/strict';

process.env.GESTOR_USUARIO = 'Gestor';
process.env.GESTOR_SENHA = 'senha-forte-123';
const { POST, blob } = await import('../api/gestor.js');

const arquivos = {
  'controle/ana.json': { nome: 'Ana', sal: 'x', hash: 'y', dados: { meses: { '2026-11': { lojas: [{ id: '1', loja: 'A', link: 'Proposta aceita' }], calc: {} } },
    reunioes: [{ id: 'r1', data: '2026-11-20T10:00:00Z', cliente: 'Prime', ficha: 'texto longo', feedback: { nota: 7 } }] } },
  'controle/bruno.json': { nome: 'Bruno', sal: 'x', hash: 'y', dados: { meses: {} } }
};
blob.list = async function (op) {
  assert.equal(op.prefix, 'controle/');
  return op.cursor ? { blobs: [{ pathname: 'controle/bruno.json' }], hasMore: false }
    : { blobs: [{ pathname: 'controle/ana.json' }], hasMore: true, cursor: 'c2' };
};
blob.get = async function (caminho) {
  return { statusCode: 200, stream: new Response(JSON.stringify(arquivos[caminho])).body };
};
async function chamar(corpo) {
  const r = await POST(new Request('http://x/api/gestor', { method: 'POST', body: JSON.stringify(corpo) }));
  return { status: r.status, json: await r.json() };
}

assert.equal((await chamar({ acao: 'entrar', usuario: 'gestor', senha: 'errada' })).status, 401);
assert.equal((await chamar({ acao: 'dados', chave: 'qualquer.coisa' })).status, 401);
assert.equal((await chamar({ acao: 'dados', chave: '1.abc' })).status, 401);   // vencida

let r = await chamar({ acao: 'entrar', usuario: ' GESTOR ', senha: 'senha-forte-123' });
assert.equal(r.status, 200);
const chave = r.json.chave;
r = await chamar({ acao: 'dados', chave: chave });
assert.equal(r.status, 200);
assert.deepEqual(r.json.vendedores.map(function (v) { return v.nome; }), ['Ana', 'Bruno']);   // lê todas as páginas
const ana = r.json.vendedores[0];
assert.equal(ana.reunioes[0].feedback.nota, 7);
assert.equal(JSON.stringify(r.json).includes('hash'), false);    // não devolve o PIN
assert.equal(JSON.stringify(r.json).includes('texto longo'), false);   // nem a ficha

process.env.GESTOR_SENHA = 'outra';   // trocou a senha: a chave antiga deixa de valer
assert.equal((await chamar({ acao: 'dados', chave: chave })).status, 401);
console.log('ok: api/gestor');
