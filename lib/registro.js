// Logs sem conteúdo sensível e controle de chamadas repetidas.
//
// Sem banco de dados (decisão desta primeira versão), o controle de repetição é em memória:
// vale enquanto a mesma instância da função estiver ativa (a Vercel reaproveita instâncias),
// o que cobre as repetições rápidas do Power Automate. Não é garantia absoluta — ver
// docs/automacao-teams.md.
import { createHash } from 'node:crypto';

const VALIDADE = 12 * 60 * 60 * 1000;   // 12 h
const vistos = new Map();                // chave → { estado, quando, resumo }

export function hash(texto, tamanho) {
  return createHash('sha256').update(String(texto)).digest('hex').slice(0, tamanho || 16);
}

// Mesma reunião + mesma transcrição = mesma chave
export function chaveReuniao(meetingId, transcriptId) {
  return hash(meetingId + '\u0000' + transcriptId, 24);
}

function limpar() {
  const agora = Date.now();
  vistos.forEach(function (v, k) { if (agora - v.quando > VALIDADE) vistos.delete(k); });
}

export function consultar(chave) {
  limpar();
  return vistos.get(chave) || null;
}

// estado: 'processando' | 'concluido' | 'falhou' (falhou libera nova tentativa)
export function marcar(chave, estado, resumo) {
  if (estado === 'falhou') { vistos.delete(chave); return; }
  vistos.set(chave, { estado: estado, quando: Date.now(), resumo: resumo || null });
}

// Log em JSON de uma linha. Nunca recebe transcrição, documentos, e-mails completos nem segredos.
export function log(evento, dados) {
  const linha = Object.assign({ evento: evento, em: new Date().toISOString() }, dados || {});
  (evento.indexOf('erro') !== -1 || evento.indexOf('falh') !== -1 ? console.error : console.log)(JSON.stringify(linha));
}
