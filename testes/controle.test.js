// Teste do api/controle.js com um Blob falso em memória. Rodar: node testes/controle.test.js
import assert from 'node:assert/strict';
import { POST, blob } from '../api/controle.js';

const mem = new Map();
let n = 0;
blob.get = async function (caminho) {
  const v = mem.get(caminho);
  return v ? { statusCode: 200, stream: new Response(v.corpo).body, blob: { etag: v.etag } } : null;
};
blob.put = async function (caminho, corpo, op) {
  const v = mem.get(caminho);
  if (v && !op.allowOverwrite) throw new Error('já existe');
  if (op.ifMatch && v.etag !== op.ifMatch) throw new Error('etag');
  const etag = 'e' + (++n);
  mem.set(caminho, { corpo: corpo, etag: etag });
  return { etag: etag };
};

async function chamar(corpo) {
  const r = await POST(new Request('http://x/api/controle', { method: 'POST', body: JSON.stringify(corpo) }));
  return { status: r.status, json: await r.json() };
}

let r = await chamar({ acao: 'ler', nome: 'João Silva', pin: '1234' });
assert.equal(r.status, 200); assert.deepEqual(r.json.dados, {}); assert.equal(r.json.etag, null);

r = await chamar({ acao: 'salvar', nome: 'João Silva', pin: '1234', etag: null, dados: { a: 1 } });
assert.equal(r.status, 200); const e1 = r.json.etag;
assert.ok(mem.has('controle/joao-silva.json'));
assert.ok(!mem.get('controle/joao-silva.json').corpo.includes('1234'));   // PIN não fica em texto puro

r = await chamar({ acao: 'ler', nome: 'joao  silva', pin: '1234' });   // acento, caixa e espaços não importam
assert.equal(r.status, 200); assert.deepEqual(r.json.dados, { a: 1 }); assert.equal(r.json.etag, e1);

r = await chamar({ acao: 'ler', nome: 'João Silva', pin: '9999' });
assert.equal(r.status, 401);
r = await chamar({ acao: 'salvar', nome: 'João Silva', pin: '9999', etag: e1, dados: { hack: 1 } });
assert.equal(r.status, 401);

r = await chamar({ acao: 'salvar', nome: 'João Silva', pin: '1234', etag: e1, dados: { a: 2 } });
assert.equal(r.status, 200);
r = await chamar({ acao: 'salvar', nome: 'João Silva', pin: '1234', etag: e1, dados: { a: 3 } });   // versão velha
assert.equal(r.status, 409);

assert.equal((await chamar({ acao: 'ler', nome: 'João', pin: '12' })).status, 400);
assert.equal((await chamar({ acao: 'ler', nome: '', pin: '1234' })).status, 400);
assert.equal((await chamar({ acao: 'salvar', nome: 'Ana', pin: '1234', dados: [] })).status, 400);
console.log('ok: api/controle');
