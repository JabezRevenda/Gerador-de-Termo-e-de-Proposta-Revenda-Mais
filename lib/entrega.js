// Entrega dos documentos ao vendedor responsável pela reunião.
//
// 1) Quem é o vendedor (resolverVendedor) — nesta ordem:
//    a. VENDEDORES (variável de ambiente, JSON): { "<organizerId>": { "nome": "...", "email": "..." } }
//    b. organizerEmail enviado pelo Power Automate (só se for um e-mail válido)
//    c. Microsoft Graph: GET /users/{organizerId} (precisa da permissão User.Read.All)
//    O organizerId NUNCA é tratado como e-mail.
// 2) Canal: e-mail pelo Microsoft Graph (sendMail), a partir da caixa MS_REMETENTE.
//    Precisa de MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET e MS_REMETENTE
//    (app registrado no Entra ID com Mail.Send de aplicativo). Ver docs/automacao-teams.md.
// Sem configuração, nada é "fingido": devolvemos { ok: false, motivo, passos }.
import { esc } from './documentos.js';

const GRAPH = function () { return (process.env.MS_GRAPH_URL || 'https://graph.microsoft.com/v1.0').replace(/\/$/, ''); };
const LOGIN = function () { return (process.env.MS_LOGIN_URL || 'https://login.microsoftonline.com').replace(/\/$/, ''); };
const RE_EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export function mascararEmail(email) {
  const [u, d] = String(email || '').split('@');
  return d ? u.slice(0, 1) + '***@' + d : '';
}

function credenciaisGraph() {
  const c = { tenant: process.env.MS_TENANT_ID, id: process.env.MS_CLIENT_ID, segredo: process.env.MS_CLIENT_SECRET };
  return c.tenant && c.id && c.segredo ? c : null;
}

export function emailConfigurado() {
  return !!(credenciaisGraph() && RE_EMAIL.test(process.env.MS_REMETENTE || ''));
}

/* ── Token do Graph (client credentials), guardado enquanto vale ───── */
let tokenCache = null;
async function tokenGraph() {
  if (tokenCache && tokenCache.expira > Date.now() + 60000) return tokenCache.valor;
  const c = credenciaisGraph();
  const resp = await fetch(LOGIN() + '/' + encodeURIComponent(c.tenant) + '/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.segredo, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  });
  if (!resp.ok) throw new Error('Graph: não consegui autenticar o app (HTTP ' + resp.status + '). Confira MS_TENANT_ID, MS_CLIENT_ID e MS_CLIENT_SECRET.');
  const j = await resp.json();
  tokenCache = { valor: j.access_token, expira: Date.now() + (Number(j.expires_in) || 3000) * 1000 };
  return tokenCache.valor;
}

/* ── Vendedor responsável ─────────────────────────────────────────── */
function mapaVendedores() {
  if (!process.env.VENDEDORES) return {};
  try { return JSON.parse(process.env.VENDEDORES) || {}; } catch (e) { return {}; }
}

/**
 * @param {{ organizerId: string, organizerEmail?: string, organizerName?: string }} meta
 * @returns {Promise<{ ok: true, nome: string, email: string, fonte: string } | { ok: false, motivo: string, passos: string[] }>}
 */
export async function resolverVendedor(meta) {
  const doMapa = mapaVendedores()[meta.organizerId];
  if (doMapa) {
    const email = typeof doMapa === 'string' ? doMapa : doMapa.email;
    if (RE_EMAIL.test(email || '')) return { ok: true, nome: (doMapa.nome || meta.organizerName || ''), email: email, fonte: 'mapa' };
  }
  if (RE_EMAIL.test(meta.organizerEmail || '')) {
    return { ok: true, nome: meta.organizerName || '', email: meta.organizerEmail, fonte: 'payload' };
  }
  if (credenciaisGraph()) {
    try {
      const token = await tokenGraph();
      const resp = await fetch(GRAPH() + '/users/' + encodeURIComponent(meta.organizerId) + '?$select=id,displayName,mail,userPrincipalName', {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (resp.ok) {
        const u = await resp.json();
        const upn = u.userPrincipalName && u.userPrincipalName.indexOf('#EXT#') === -1 ? u.userPrincipalName : '';
        const email = RE_EMAIL.test(u.mail || '') ? u.mail : RE_EMAIL.test(upn) ? upn : '';
        if (email) return { ok: true, nome: u.displayName || '', email: email, fonte: 'graph' };
        return { ok: false, motivo: 'O usuário do organizador foi encontrado no Microsoft 365, mas não tem caixa de e-mail.', passos: ['Cadastre o e-mail desse vendedor na variável VENDEDORES da Vercel.'] };
      }
      if (resp.status === 404) {
        return { ok: false, motivo: 'O organizerId não corresponde a nenhum usuário do Microsoft 365 da empresa.', passos: ['Confira se o Power Automate envia o ID do organizador (Entra ID) ou cadastre-o em VENDEDORES.'] };
      }
      return { ok: false, motivo: 'O Microsoft Graph não deixou consultar o organizador (HTTP ' + resp.status + ').', passos: ['Dê ao app a permissão de aplicativo User.Read.All (com consentimento do administrador) ou cadastre o vendedor em VENDEDORES.'] };
    } catch (e) {
      return { ok: false, motivo: e.message, passos: ['Confira as variáveis MS_TENANT_ID, MS_CLIENT_ID e MS_CLIENT_SECRET.'] };
    }
  }
  return {
    ok: false,
    motivo: 'Não foi possível identificar o vendedor: o organizerId não está em VENDEDORES, não veio organizerEmail e o Microsoft Graph não está configurado.',
    passos: [
      'Opção 1: mandar "organizerEmail" no corpo da chamada do Power Automate.',
      'Opção 2: cadastrar na Vercel a variável VENDEDORES = {"<organizerId>": {"nome": "...", "email": "..."}}.',
      'Opção 3: configurar o Microsoft Graph (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET) com a permissão User.Read.All.'
    ]
  };
}

/* ── Mensagem ao vendedor ─────────────────────────────────────────── */
/**
 * @param {{ reuniao: object, vendedor: object, parecer: object, proposta: object, pendencias: string[], processadoEm: Date }} m
 *   parecer/proposta: { ok, titulo, html, texto, resumoCrm, erro }
 */
export function montarEmail(m) {
  const quando = m.processadoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const assunto = '[Reunião processada] ' + (m.empresa || m.reuniao.subject || 'Parecer e proposta') + ' — ' + quando.slice(0, 10);
  const linhaMeta = function (rot, val) { return val ? '<tr><td style="padding:2px 12px 2px 0;color:#6b7280">' + rot + '</td><td style="padding:2px 0">' + esc(val) + '</td></tr>' : ''; };
  const pend = m.pendencias.length
    ? '<ul style="margin:0;padding-left:20px">' + m.pendencias.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>'
    : '<p style="margin:0;color:#6b7280">Nenhuma pendência apontada pela IA — mesmo assim, confira os documentos.</p>';
  const bloco = function (titulo, doc, aviso) {
    return '<h2 style="margin:28px 0 4px;font-size:17px;color:#E8003D">' + esc(titulo) + '</h2>' + (aviso || '') +
      (doc.ok ? (doc.htmlEmail || doc.html) : '<p style="color:#b91c1c">Não foi possível gerar este documento: ' + esc(doc.erro) + '</p>');
  };
  const html = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;max-width:760px">' +
    '<p style="margin:0 0 12px">Olá' + (m.vendedor.nome ? ', ' + esc(m.vendedor.nome.split(' ')[0]) : '') + '! A reunião abaixo foi processada automaticamente. ' +
    '<b>Os documentos foram gerados por IA a partir da transcrição: confira tudo antes de usar.</b></p>' +
    '<table style="border-collapse:collapse;font-size:13px;margin:0 0 16px">' +
      linhaMeta('Reunião', m.reuniao.subject) + linhaMeta('ID da reunião', m.reuniao.meetingId) + linhaMeta('ID da transcrição', m.reuniao.transcriptId) +
      linhaMeta('Data da reunião', m.reuniao.meetingDate) + linhaMeta('Processado em', quando + ' (horário de Brasília)') +
    '</table>' +
    '<div style="border-left:4px solid #E8003D;background:#fff1f4;padding:10px 14px;margin:0 0 8px"><b>Informações que precisam ser confirmadas</b>' + pend + '</div>' +
    bloco('1. Parecer comercial (para o CRM)', m.parecer,
      m.parecer.ok && m.parecer.resumoCrm ? '<p style="margin:6px 0 4px;color:#6b7280;font-size:12px">Resumo pronto para colar no CRM:</p><pre style="white-space:pre-wrap;font-family:inherit;background:#f3f4f6;border-radius:6px;padding:10px 12px;margin:0 0 8px">' + esc(m.parecer.resumoCrm) + '</pre>' : '') +
    bloco('2. Proposta comercial — RASCUNHO', m.proposta,
      '<p style="margin:6px 0 8px;color:#b45309;font-size:12px"><b>Rascunho:</b> não envie ao cliente sem revisar valores, prazos e condições. Itens que não estão como "Acordado" ainda não são compromisso.</p>') +
    '<p style="margin:28px 0 0;font-size:12px;color:#9ca3af">Gerador de Propostas Revenda Mais · processamento automático da transcrição do Teams.</p>' +
    '</div>';
  return { assunto: assunto, html: html };
}

/**
 * Envia o e-mail pelo Microsoft Graph. Devolve { ok: true, canal, destino } ou { ok: false, motivo, passos }.
 */
export async function enviarEmail(vendedor, email) {
  if (!emailConfigurado()) {
    return {
      ok: false,
      motivo: 'O envio de e-mail não está configurado.',
      passos: ['Registre um app no Microsoft Entra ID com a permissão de aplicativo Mail.Send (com consentimento do administrador) e cadastre na Vercel: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET e MS_REMETENTE (caixa que envia). Ver docs/automacao-teams.md.']
    };
  }
  try {
    const token = await tokenGraph();
    const resp = await fetch(GRAPH() + '/users/' + encodeURIComponent(process.env.MS_REMETENTE) + '/sendMail', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: email.assunto,
          body: { contentType: 'HTML', content: email.html },
          toRecipients: [{ emailAddress: { address: vendedor.email, name: vendedor.nome || undefined } }]
        },
        saveToSentItems: true
      })
    });
    if (resp.status === 202 || resp.ok) return { ok: true, canal: 'email', destino: mascararEmail(vendedor.email) };
    return {
      ok: false,
      motivo: 'O Microsoft Graph recusou o envio do e-mail (HTTP ' + resp.status + ').',
      passos: [resp.status === 403
        ? 'Dê ao app a permissão de aplicativo Mail.Send (com consentimento do administrador) e confira se MS_REMETENTE é uma caixa válida.'
        : 'Confira MS_REMETENTE e as permissões do app no Entra ID.']
    };
  } catch (e) {
    return { ok: false, motivo: e.message, passos: ['Confira as variáveis do Microsoft Graph na Vercel.'] };
  }
}
