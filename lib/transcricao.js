// Normaliza a transcrição recebida (texto puro ou VTT do Teams) para mandar à IA.
// VTT do Teams: blocos com horário ("00:00:01.000 --> 00:00:05.000") e falas em
// "<v Nome da Pessoa>texto</v>". Viram linhas "Nome da Pessoa: texto".
export const LIMITE_TRANSCRICAO = 600000;   // caracteres depois de limpar (~4 h de reunião)
export const MINIMO_TRANSCRICAO = 80;

function desfazerEntidades(t) {
  return t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

export function ehVtt(texto) {
  return /^﻿?WEBVTT/.test(texto) || /\d{2}:\d{2}[:.]\d{2}[.,]\d{3}\s+-->\s+\d{2}:\d{2}/.test(texto);
}

export function normalizarTranscricao(bruto) {
  let t = String(bruto == null ? '' : bruto).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  if (ehVtt(t)) {
    const linhas = [];
    let ultimo = null;
    t.split('\n').forEach(function (l) {
      const s = l.trim();
      if (!s || /^﻿?WEBVTT/.test(s) || /-->/.test(s) || /^\d+$/.test(s) || /^(NOTE|STYLE|REGION|Kind:|Language:)/.test(s)) return;
      // identificador de bloco do Teams (ex.: "3a2b.../12-0")
      if (/^[0-9a-f-]{8,}\/\d+-\d+$/i.test(s)) return;
      let fala = s.replace(/<v\s+([^>]+)>/g, '$1: ').replace(/<\/?[^>]+>/g, '');
      fala = desfazerEntidades(fala).replace(/\s+/g, ' ').trim();
      if (!fala) return;
      // mesma pessoa em blocos seguidos: junta na mesma linha
      const m = fala.match(/^([^:]{1,80}):\s+(.*)$/);
      if (m && ultimo && ultimo.nome === m[1]) { ultimo.texto += ' ' + m[2]; return; }
      ultimo = m ? { nome: m[1], texto: m[2] } : { nome: null, texto: fala };
      linhas.push(ultimo);
    });
    t = linhas.map(function (x) { return x.nome ? x.nome + ': ' + x.texto : x.texto; }).join('\n');
  }
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
