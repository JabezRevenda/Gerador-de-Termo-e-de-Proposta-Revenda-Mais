// Contas da calculadora (calculadora.html) com a tabela de precos.js. Rodar: node testes/calculadora.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../calculadora.html', import.meta.url), 'utf8');
const js = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>')).replace(/\nrender\(\);\s*$/, '');
const c = {};
vm.createContext(c);
vm.runInContext(fs.readFileSync(new URL('../precos.js', import.meta.url), 'utf8') + '\n' + js +
  ';this.calcular = calcular; this.INICIAL = INICIAL;', c);
const conta = function (muda) { const s = c.INICIAL(); muda(s); return c.calcular(s); };

let r = conta(function () {});                                         // Plano 1.0
assert.equal(r.mensal, 800); assert.equal(r.anual, 750); assert.equal(r.adesao, 1000);
r = conta(function (s) { s.add = { nf: true, renave: true, cnpj: true }; s.cnpjQtd = 2; });
assert.equal(r.mensal, 1430); assert.equal(r.anual, 1330);               // NF anual 350
r = conta(function (s) { s.add = { nf: true, renave: true, cnpj: true }; s.cnpjQtd = 2; s.desc = 10; s.descTipo = '%'; });
assert.equal(r.mensal, 1350); assert.equal(r.anual, 1250);               // 10% de R$ 800 = R$ 80, só no plano
r = conta(function (s) { s.crmOn = true; s.crmUsuarios = 5; s.iaOn = true; s.franquias = 2; });
assert.equal(r.mensal, 800); assert.equal(r.aParte.map(function (a) { return a.valor; }).join(), '700,1992'); assert.equal(r.setup, 390);
r = conta(function (s) { s.base = 'nf'; s.add = { renave: true, crm: true }; s.desc = 100; });
assert.equal(r.mensal, 830); assert.equal(r.anual, 780); assert.equal(r.adesao, 0);   // no NF o desconto abate o total
r = conta(function (s) { s.base = 'crm'; s.crmUsuarios = 4; s.add = { nf: true }; });
assert.equal(r.mensal, 1000); assert.equal(r.setup, 390);
r = conta(function (s) { s.base = 'ia'; s.franquias = 3; });
assert.equal(r.mensal, 2988); assert.equal(r.leads, 1500);
console.log('ok: calculadora');
