// Porta de entrada do Power Automate (reuniões do Teams). Protegida pela chave TEAMS_CHAVE,
// que o fluxo manda no cabeçalho x-hub-chave. Responde na hora (202) e a IA analisa em seguida.
//
// Corpo (JSON):
//   { "evento": "reuniao",     "id": "...", "email": "organizador@...", "titulo": "...", "inicio": "2026-11-28T14:00:00Z" }
//   { "evento": "transcricao", "id": "...", "email": "...", "titulo": "...", "inicio": "...", "transcricao": "texto da reunião" }
//   { "evento": "erro",        "id": "...", "email": "...", "titulo": "...", "motivo": "o que falhou no fluxo" }
// O id é o mesmo da reunião nos três eventos (ex.: o id da reunião no Teams).
import { waitUntil } from '@vercel/functions';
import { createHash, timingSafeEqual } from 'node:crypto';
import { registrar, processar } from './_teams.js';

const LIMITE = 500000;   // caracteres (~3 h de reunião)

function resposta(status, corpo) {
  return Response.json(corpo, { status: status });
}
function igual(a, b) {
  return timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
}

export async function POST(request) {
  if (!process.env.TEAMS_CHAVE) return resposta(503, { erro: 'Falta a variável TEAMS_CHAVE na Vercel.' });
  if (!igual(request.headers.get('x-hub-chave') || '', process.env.TEAMS_CHAVE)) return resposta(401, { erro: 'Chave inválida.' });

  const texto = await request.text();
  if (texto.length > LIMITE) return resposta(413, { erro: 'Transcrição grande demais.' });
  let corpo;
  try { corpo = JSON.parse(texto); } catch (e) { return resposta(400, { erro: 'JSON inválido.' }); }
  if (['reuniao', 'transcricao', 'erro'].indexOf(corpo.evento) === -1) {
    return resposta(400, { erro: 'evento deve ser "reuniao", "transcricao" ou "erro".' });
  }

  try {
    const r = await registrar(corpo);
    if (r.processar) waitUntil(processar(r.id).catch(function (e) { console.error(e); }));
    return resposta(202, { ok: true, id: r.id, status: r.processar ? 'analisando' : 'registrada' });
  } catch (e) {
    console.error(e);
    return resposta(502, { erro: 'Não consegui registrar agora. Tente de novo.' });
  }
}
