// O mesmo pedido para a IA que o hub usa no navegador (precos.js + ia-pedido.js), carregado no
// servidor para analisar as reuniões que chegam do Teams. vercel.json inclui os dois arquivos.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

let contexto = null;

export function pedido() {
  if (!contexto) {
    contexto = {};
    vm.createContext(contexto);
    const ler = function (nome) { return fs.readFileSync(path.join(process.cwd(), nome), 'utf8'); };
    vm.runInContext(ler('precos.js') + '\n' + ler('ia-pedido.js'), contexto);
  }
  return contexto;   // iaInstrucoes(), iaSchema(), crmFichaTexto(r), iaTxt(v)
}
