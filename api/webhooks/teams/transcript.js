// POST /api/webhooks/teams/transcript
//
// Recebe do Power Automate a transcrição de uma reunião do Microsoft Teams, gera com IA o
// parecer comercial (CRM) e a proposta comercial (rascunho) e entrega ao vendedor organizador.
// Configuração e fluxo do Power Automate: docs/automacao-teams.md.
//
// Corpo (JSON):
//   { "meetingId", "transcriptId", "transcript" (texto ou VTT), "organizerId",
//     opcionais: "organizerEmail", "organizerName", "subject", "meetingDate" }
// Cabeçalho obrigatório: x-webhook-secret = TEAMS_WEBHOOK_SECRET
//
// Respostas:
//   202 aceito        → vendedor e e-mail configurados: processa em segundo plano e envia por e-mail
//   200 processado    → sem canal de entrega configurado: os documentos voltam na resposta e
//                       "entrega.status" = "pendente" (com o motivo e os passos para configurar)
//   200 duplicado     → mesma reunião + transcrição já processada (repete a resposta anterior)
//   202 em_processamento → a mesma transcrição ainda está sendo processada
//   400/413/415/422   → corpo inválido · 401 segredo inválido · 503 não configurado · 5xx falha
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { provedorIA, traduzirErroIA } from '../../../lib/ia.js';
import { normalizarTranscricao, LIMITE_TRANSCRICAO, MINIMO_TRANSCRICAO } from '../../../lib/transcricao.js';
import { MODELOS, NAO_INFORMADO, gerarDocumentos, textoDoDocumento, htmlDoDocumento, pendenciasDe, resumoCrmTexto } from '../../../lib/documentos.js';
import { resolverVendedor, emailConfigurado, montarEmail, enviarEmail, mascararEmail } from '../../../lib/entrega.js';
import { chaveReuniao, consultar, marcar, log } from '../../../lib/registro.js';

const LIMITE_CORPO = 4 * 1024 * 1024;   // a Vercel aceita até 4,5 MB por requisição
const CAMPOS_OBRIGATORIOS = ['meetingId', 'transcriptId', 'transcript', 'organizerId'];
const CAMPOS_OPCIONAIS = ['organizerEmail', 'organizerName', 'subject', 'meetingDate'];

function resposta(status, corpo, extras) {
  return Response.json(corpo, { status: status, headers: Object.assign({ 'Cache-Control': 'no-store' }, extras || {}) });
}

// Comparação em tempo constante (o hash iguala os tamanhos, então não vaza nem o comprimento)
function segredoConfere(recebido, esperado) {
  if (!recebido) return false;
  const a = createHash('sha256').update(recebido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

function validarCorpo(corpo) {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { erro: 'O corpo deve ser um objeto JSON.', campos: CAMPOS_OBRIGATORIOS };
  const invalidos = CAMPOS_OBRIGATORIOS.filter(function (k) {
    const v = corpo[k];
    return typeof v !== 'string' || !v.trim() || (k !== 'transcript' && v.length > 512);
  });
  CAMPOS_OPCIONAIS.forEach(function (k) {
    if (corpo[k] != null && (typeof corpo[k] !== 'string' || corpo[k].length > 512)) invalidos.push(k);
  });
  return invalidos.length ? { erro: 'Campos ausentes ou inválidos.', campos: invalidos } : null;
}

// Monta os dois documentos (texto, HTML e dados) a partir do que a IA devolveu
async function processar(transcricao) {
  const gerados = await gerarDocumentos(transcricao);
  const docs = {};
  Object.keys(MODELOS).forEach(function (k) {
    const modelo = MODELOS[k], r = gerados[k];
    if (!r.ok) {
      const t = traduzirErroIA(r.erro);
      docs[k] = { ok: false, titulo: modelo.titulo, erro: t.erro, codigo: t.codigo, status: t.status };
      return;
    }
    docs[k] = {
      ok: true, titulo: modelo.titulo, dados: r.dados,
      texto: textoDoDocumento(modelo, r.dados),
      html: htmlDoDocumento(modelo, r.dados),
      htmlEmail: htmlDoDocumento(modelo, r.dados, { semCampos: true }),
      pendencias: pendenciasDe(modelo, r.dados),
      resumoCrm: resumoCrmTexto(modelo, r.dados)
    };
  });
  const pendencias = [];
  ['parecer', 'proposta'].forEach(function (k) {
    (docs[k].pendencias || []).forEach(function (p) { if (pendencias.indexOf(p) === -1) pendencias.push(p); });
  });
  const empresa = [docs.parecer, docs.proposta].map(function (d) { return d.ok ? String(d.dados.empresa || '') : ''; })
    .find(function (e) { return e && e !== NAO_INFORMADO && e.length <= 80; }) || '';
  return { docs: docs, pendencias: pendencias, empresa: empresa };
}

function documentosParaResposta(docs) {
  const saida = {};
  Object.keys(docs).forEach(function (k) {
    const d = docs[k];
    saida[k] = d.ok
      ? { ok: true, titulo: d.titulo, texto: d.texto, html: d.html, dados: d.dados, resumoCrm: d.resumoCrm || undefined }
      : { ok: false, titulo: d.titulo, erro: d.erro, codigo: d.codigo };
  });
  return saida;
}

// Segundo plano: gera, envia por e-mail e registra. Falha também avisa o vendedor.
async function processarEEntregar(ctx) {
  const inicio = Date.now();
  try {
    const r = await processar(ctx.transcricao);
    const processadoEm = new Date();
    log('documentos_gerados', { req: ctx.req, reuniao: ctx.chave, parecer: r.docs.parecer.ok, proposta: r.docs.proposta.ok, ms: Date.now() - inicio });
    const email = montarEmail({ reuniao: ctx.reuniao, vendedor: ctx.vendedor, parecer: r.docs.parecer, proposta: r.docs.proposta, pendencias: r.pendencias, empresa: r.empresa, processadoEm: processadoEm });
    if (!r.docs.parecer.ok && !r.docs.proposta.ok) email.assunto = '[Falha] Não foi possível processar a reunião' + (ctx.reuniao.subject ? ' ' + ctx.reuniao.subject : '');
    const envio = await enviarEmail(ctx.vendedor, email);
    if (!envio.ok) {
      log('entrega_falhou', { req: ctx.req, reuniao: ctx.chave, motivo: envio.motivo });
      marcar(ctx.chave, 'falhou');
      return;
    }
    log('entrega_ok', { req: ctx.req, reuniao: ctx.chave, canal: envio.canal, destino: envio.destino });
    marcar(ctx.chave, r.docs.parecer.ok || r.docs.proposta.ok ? 'concluido' : 'falhou', { status: 'duplicado', processadoEm: processadoEm.toISOString(), entrega: { status: 'enviada', canal: envio.canal, destino: envio.destino } });
  } catch (e) {
    log('erro_interno', { req: ctx.req, reuniao: ctx.chave, tipo: e && e.name });
    marcar(ctx.chave, 'falhou');
  }
}

export async function POST(request) {
  const req = randomUUID().slice(0, 8);

  // 1. Autenticação (antes de ler o corpo)
  const esperado = process.env.TEAMS_WEBHOOK_SECRET;
  if (!esperado) {
    log('webhook_nao_configurado', { req: req });
    return resposta(503, { erro: 'Webhook não configurado no servidor.' });
  }
  if (!segredoConfere(request.headers.get('x-webhook-secret'), esperado)) {
    log('webhook_negado', { req: req, motivo: request.headers.get('x-webhook-secret') ? 'segredo_invalido' : 'sem_segredo' });
    return resposta(401, { erro: 'Não autorizado.' });
  }

  // 2. Formato do pedido
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) {
    return resposta(415, { erro: 'Envie o corpo como application/json.' });
  }
  if (Number(request.headers.get('content-length') || 0) > LIMITE_CORPO) {
    return resposta(413, { erro: 'Corpo grande demais (máx. 4 MB).' });
  }
  let corpo;
  try {
    const bruto = await request.text();
    if (bruto.length > LIMITE_CORPO) return resposta(413, { erro: 'Corpo grande demais (máx. 4 MB).' });
    corpo = JSON.parse(bruto);
  } catch (e) {
    return resposta(400, { erro: 'JSON inválido.' });
  }
  const invalido = validarCorpo(corpo);
  if (invalido) {
    log('payload_invalido', { req: req, campos: invalido.campos });
    return resposta(422, invalido);
  }
  const transcricao = normalizarTranscricao(corpo.transcript);
  if (transcricao.length < MINIMO_TRANSCRICAO) return resposta(422, { erro: 'A transcrição está vazia ou curta demais.', campos: ['transcript'] });
  if (transcricao.length > LIMITE_TRANSCRICAO) return resposta(413, { erro: 'A transcrição é grande demais para processar de uma vez.' });

  const reuniao = {
    meetingId: corpo.meetingId.trim(), transcriptId: corpo.transcriptId.trim(),
    subject: (corpo.subject || '').trim(), meetingDate: (corpo.meetingDate || '').trim()
  };
  const chave = chaveReuniao(reuniao.meetingId, reuniao.transcriptId);
  const ident = { meetingId: reuniao.meetingId, transcriptId: reuniao.transcriptId, chave: chave };
  log('webhook_recebido', { req: req, reuniao: chave, caracteres: transcricao.length });

  // 3. Repetição da mesma reunião/transcrição
  const anterior = consultar(chave);
  if (anterior && anterior.estado === 'processando') {
    log('duplicado_em_andamento', { req: req, reuniao: chave });
    return resposta(202, { status: 'em_processamento', duplicado: true, reuniao: ident });
  }
  if (anterior && anterior.estado === 'concluido') {
    log('duplicado_concluido', { req: req, reuniao: chave });
    return resposta(200, Object.assign({}, anterior.resumo, { status: 'duplicado', duplicado: true, reuniao: ident }));
  }

  if (!provedorIA()) {
    log('ia_nao_configurada', { req: req, reuniao: chave });
    return resposta(503, { codigo: 'ia_nao_configurada', erro: 'A IA não está configurada no servidor (OPENAI_API_KEY ou ANTHROPIC_API_KEY).' });
  }

  try {
    // 4. Vendedor e canal de entrega
    const vendedor = await resolverVendedor({ organizerId: corpo.organizerId.trim(), organizerEmail: corpo.organizerEmail, organizerName: corpo.organizerName });
    const podeEnviar = vendedor.ok && emailConfigurado();

    if (podeEnviar) {
      // Responde logo (o Power Automate espera no máximo ~2 min) e segue em segundo plano
      marcar(chave, 'processando');
      const tarefa = processarEEntregar({ req: req, chave: chave, reuniao: reuniao, transcricao: transcricao, vendedor: vendedor });
      waitUntil(tarefa);
      log('aceito', { req: req, reuniao: chave, vendedor: vendedor.fonte });
      return resposta(202, { status: 'aceito', reuniao: ident, entrega: { status: 'agendada', canal: 'email', destino: mascararEmail(vendedor.email) } });
    }

    // Sem canal configurado: processa agora e devolve os documentos, com a pendência explícita
    marcar(chave, 'processando');
    const inicio = Date.now();
    const r = await processar(transcricao);
    const processadoEm = new Date();
    log('documentos_gerados', { req: req, reuniao: chave, parecer: r.docs.parecer.ok, proposta: r.docs.proposta.ok, ms: Date.now() - inicio });

    if (!r.docs.parecer.ok && !r.docs.proposta.ok) {
      marcar(chave, 'falhou');
      const p = r.docs.parecer;
      return resposta(p.status && p.status >= 400 ? p.status : 502, { status: 'falhou', codigo: p.codigo, erro: p.erro, reuniao: ident });
    }

    const pendenciaEntrega = vendedor.ok
      ? { status: 'pendente', motivo: 'O envio de e-mail não está configurado.', passos: ['Configure o Microsoft Graph (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REMETENTE) ou entregue pelo Power Automate usando "mensagem" desta resposta. Ver docs/automacao-teams.md.'], vendedor: { nome: vendedor.nome, email: vendedor.email, fonte: vendedor.fonte } }
      : { status: 'pendente', motivo: vendedor.motivo, passos: vendedor.passos };
    log('entrega_pendente', { req: req, reuniao: chave, motivo: pendenciaEntrega.motivo });

    const email = montarEmail({ reuniao: reuniao, vendedor: vendedor.ok ? vendedor : { nome: '' }, parecer: r.docs.parecer, proposta: r.docs.proposta, pendencias: r.pendencias, empresa: r.empresa, processadoEm: processadoEm });
    const corpoResp = {
      status: r.docs.parecer.ok && r.docs.proposta.ok ? 'processado' : 'processado_parcial',
      reuniao: ident,
      processadoEm: processadoEm.toISOString(),
      entrega: pendenciaEntrega,
      pendencias: r.pendencias,
      documentos: documentosParaResposta(r.docs),
      // pronta para o Power Automate encaminhar ao vendedor (e-mail ou Teams)
      mensagem: { assunto: email.assunto, html: email.html }
    };
    marcar(chave, 'concluido', corpoResp);
    return resposta(200, corpoResp);
  } catch (e) {
    marcar(chave, 'falhou');
    log('erro_interno', { req: req, reuniao: chave, tipo: e && e.name });
    return resposta(500, { erro: 'Falha interna ao processar a reunião.', req: req });
  }
}
