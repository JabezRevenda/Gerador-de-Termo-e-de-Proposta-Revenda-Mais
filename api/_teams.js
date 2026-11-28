// Reuniões do Teams: o Power Automate manda os eventos (api/teams.js), a IA analisa no servidor e o
// resultado vai para o Controle do vendedor (achado pelo e-mail). Cada reunião tem um arquivo
// teams/<id>.json com a situação, para o painel do gestor ver o que deu errado.
import { get, put, list, BlobPreconditionFailedError } from '@vercel/blob';
import { analisar, traduzirErro } from './_ia.js';
import { pedido } from './_pedido.js';

export const blob = { get, put, list };   // trocados por falsos no teste (testes/teams.test.js)
export const ia = { analisar };

const SEM_TRANSCRICAO = 3 * 60 * 60 * 1000;   // gravou e a transcrição não chegou em 3 h
const ANALISE_TRAVADA = 15 * 60 * 1000;
const DIAS_NO_PAINEL = 45;
const REUNIOES_MAX = 100;

function txt(v) { return String(v == null ? '' : v).trim(); }
export function idSeguro(id) { return txt(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80); }

async function lerJson(caminho) {
  const r = await blob.get(caminho, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return { dados: JSON.parse(await new Response(r.stream).text()), etag: r.blob.etag };
}
export async function lerReuniao(id) {
  const r = await lerJson('teams/' + idSeguro(id) + '.json');
  return r && r.dados;
}
async function salvarReuniao(m) {
  m.atualizadoEm = new Date().toISOString();
  await blob.put('teams/' + m.id + '.json', JSON.stringify(m), {
    access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true
  });
  return m;
}
function falhou(m, motivo) {
  m.status = 'erro';
  m.motivo = motivo;
  return salvarReuniao(m);
}

// Evento do Power Automate: 'reuniao' (gravou), 'transcricao' (com o texto) ou 'erro' (o fluxo falhou)
export async function registrar(c) {
  const id = idSeguro(c.id) || 't' + Date.now().toString(36);
  const m = await lerReuniao(id) || { id: id, criadoEm: new Date().toISOString(), status: 'aguardando' };
  if (txt(c.email)) m.email = txt(c.email).toLowerCase();
  if (txt(c.titulo)) m.titulo = txt(c.titulo);
  if (txt(c.inicio)) m.inicio = txt(c.inicio);

  if (c.evento === 'erro') {
    await falhou(m, 'O Power Automate avisou uma falha: ' + (txt(c.motivo) || 'o fluxo não terminou.'));
    return { id: id, processar: false };
  }
  if (c.evento === 'transcricao') {
    const t = txt(pedido().iaLimparLegenda(String(c.transcricao || '')));   // .vtt do Teams vira só quem falou e o quê
    if (t.length < 80) { await falhou(m, 'A transcrição chegou vazia ou curta demais.'); return { id: id, processar: false }; }
    m.transcricao = t;
    m.status = 'recebida';
    m.motivo = '';
    await salvarReuniao(m);
    return { id: id, processar: true };
  }
  if (m.status !== 'pronta' && m.status !== 'erro') m.status = 'aguardando';   // 'reuniao': gravou, falta a transcrição
  await salvarReuniao(m);
  return { id: id, processar: false };
}

// Analisa com a IA e entrega ao vendedor
export async function processar(id) {
  const m = await lerReuniao(id);
  if (!m) return null;
  if (m.resultado) return entregar(m);   // a IA já leu; faltou só entregar
  if (!m.transcricao) return falhou(m, 'A transcrição não está guardada. Peça para o Power Automate mandar de novo.');
  m.status = 'analisando';
  m.tentativas = (m.tentativas || 0) + 1;
  await salvarReuniao(m);
  try {
    const p = pedido();
    m.resultado = (await ia.analisar(p.iaInstrucoes(), p.iaSchema(), m.transcricao)).resultado;
  } catch (e) {
    if (!(e && e.status)) console.error(e);
    return falhou(m, 'A IA não conseguiu analisar: ' + traduzirErro(e).erro);
  }
  return entregar(m);
}

async function acharVendedor(email) {
  if (!email) return null;
  let cursor;
  do {
    const pg = await blob.list({ prefix: 'controle/', cursor: cursor });
    for (const b of pg.blobs) {
      const r = await lerJson(b.pathname);
      if (r && txt(r.dados.email).toLowerCase() === email) return { caminho: b.pathname, nome: r.dados.nome };
    }
    cursor = pg.hasMore ? pg.cursor : undefined;
  } while (cursor);
  return null;
}

// Coloca a reunião no histórico do vendedor, marcada como nova (o hub avisa ao abrir)
async function entregar(m) {
  const vend = await acharVendedor(m.email);
  if (!vend) {
    return falhou(m, m.email
      ? 'Nenhum vendedor com o e-mail ' + m.email + ' no Controle. Ele precisa entrar no Controle do hub com esse e-mail no perfil; depois é só tentar de novo.'
      : 'A reunião chegou sem o e-mail do organizador.');
  }
  const p = pedido(), r = m.resultado, lead = r.lead || {};
  const item = {
    id: 'teams-' + m.id, data: m.inicio || m.criadoEm, origem: 'teams', titulo: m.titulo || '', nova: true,
    cliente: p.iaTxt(lead.empresa) || p.iaTxt((r.proposta || {}).cliente) || m.titulo || 'Sem nome',
    contato: p.iaTxt(lead.contato), ficha: p.crmFichaTexto(r), feedback: r.feedback || null, resultado: r
  };
  for (let tentativa = 0; tentativa < 4; tentativa++) {   // o vendedor pode estar salvando ao mesmo tempo
    const atual = await lerJson(vend.caminho);
    const arq = atual.dados;
    arq.dados = arq.dados || {};
    if (!arq.dados.meses) arq.dados.meses = {};
    arq.dados.reunioes = [item].concat((arq.dados.reunioes || []).filter(function (x) { return x.id !== item.id; })).slice(0, REUNIOES_MAX);
    try {
      await blob.put(vend.caminho, JSON.stringify(arq), {
        access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, ifMatch: atual.etag
      });
      m.status = 'pronta';
      m.motivo = '';
      m.vendedor = arq.nome;
      delete m.transcricao;   // já está analisada e entregue
      delete m.resultado;
      return salvarReuniao(m);
    } catch (e) {
      if (!(e instanceof BlobPreconditionFailedError) && e.name !== 'BlobPreconditionFailedError') {
        console.error(e);
        return falhou(m, 'Não consegui guardar no Controle de ' + vend.nome + '.');
      }
    }
  }
  return falhou(m, 'O Controle de ' + vend.nome + ' estava sendo alterado. Tente de novo.');
}

// Para o painel do gestor: reuniões dos últimos dias, com a situação já calculada
export async function listarReunioes() {
  const desde = Date.now() - DIAS_NO_PAINEL * 24 * 60 * 60 * 1000;
  const saida = [];
  let cursor;
  do {
    const pg = await blob.list({ prefix: 'teams/', cursor: cursor });
    for (const b of pg.blobs) {
      if (b.uploadedAt && new Date(b.uploadedAt).getTime() < desde) continue;
      const r = await lerJson(b.pathname);
      if (!r) continue;
      const m = r.dados, ref = new Date(m.atualizadoEm || m.criadoEm).getTime();
      let situacao = m.status;
      if (m.status === 'aguardando' && Date.now() - ref > SEM_TRANSCRICAO) situacao = 'sem_transcricao';
      if ((m.status === 'analisando' || m.status === 'recebida') && Date.now() - ref > ANALISE_TRAVADA) situacao = 'travada';
      saida.push({
        id: m.id, email: m.email || '', titulo: m.titulo || '', inicio: m.inicio || '', criadoEm: m.criadoEm, atualizadoEm: m.atualizadoEm,
        status: m.status, situacao: situacao, motivo: m.motivo || '', vendedor: m.vendedor || '',
        podeTentar: !!(m.transcricao || m.resultado) && situacao !== 'pronta' && situacao !== 'analisando'
      });
    }
    cursor = pg.hasMore ? pg.cursor : undefined;
  } while (cursor);
  return saida.sort(function (a, b) { return String(b.criadoEm).localeCompare(String(a.criadoEm)); });
}
