// O pedido para a IA ler a reunião: catálogo, instruções, formato da resposta (schema) e a ficha
// do CRM em texto. Usado no navegador (index.html, depois de precos.js) e no servidor
// (api/_pedido.js, para as reuniões que chegam do Teams). Mudou aqui, vale nos dois.

const IA_NAO_IDENTIFICADO = 'Não identificado na reunião';

// Ficha do lead no formato do CRM — a ordem aqui é a ordem em que aparece e é copiada
const CRM_CAMPOS = [
  { id: 'dor_principal',       titulo: 'Dor Principal',        pergunta: 'Qual o principal problema do cliente?' },
  { id: 'processo_atual',      titulo: 'Processo Atual',       pergunta: 'Como ele resolve isso hoje?' },
  { id: 'impacto',             titulo: 'Impacto',              pergunta: 'Qual o impacto dessa dor no negócio?' },
  { id: 'solucao_apresentada', titulo: 'Solução Apresentada',  pergunta: 'O que foi apresentado para ajudar?' },
  { id: 'contexto_empresa',    titulo: 'Contexto da Empresa',  pergunta: 'Tempo de mercado e momento atual da operação.' },
  { id: 'decisor',             titulo: 'Decisor',              pergunta: 'Quem aprova a contratação?' },
  { id: 'influenciador',       titulo: 'Influenciador',        pergunta: 'Quem influencia a decisão?' },
  { id: 'valor_agregado',      titulo: 'Valor Agregado',       pergunta: 'Qual orientação, dica ou melhoria foi entregue?' }
];
const CRM_LEAD = [
  { id: 'empresa',  titulo: 'Empresa' },
  { id: 'contato',  titulo: 'Contato' },
  { id: 'cargo',    titulo: 'Cargo' },
  { id: 'telefone', titulo: 'Telefone' },
  { id: 'email',    titulo: 'E-mail' },
  { id: 'cidade',   titulo: 'Cidade / UF' }
];

// O que a IA precisa saber para montar a proposta — sai das mesmas tabelas da tela,
// então mudou preço ou plano lá em cima, o pedido acompanha
function iaCatalogo() {
  const planos = Object.keys(PLANOS).map(function (k) {
    const c = PLANOS[k];
    return '- "' + k + '" (' + (c.nome || 'Plano ' + k) + '): até ' + c.veiculos + ' veículos' +
      (c.usuarios ? ', ' + c.usuarios + ' usuários' : '') + ', R$ ' + c.valor + '/mês' +
      (k === 'integrador' ? ' — só integra o estoque aos portais de anúncio (cadastro + fotos), sem a gestão da loja' : '');
  }).join('\n');
  const adicionais = ADICIONAIS.map(function (a) {
    return '- "' + a.id + '": ' + a.nome + ' — ' + a.desc +
      (a.padrao ? ' (tabela R$ ' + a.padrao.toFixed(2).replace('.', ',') + '/mês)' : ' (sem valor de tabela: use o valor falado na reunião, senão 0)') +
      (a.fora ? ' — cobrado à parte, em boleto' : '');
  }).join('\n');
  return [
    'CATÁLOGO DA REVENDA MAIS (software para lojas de veículos)',
    '',
    'Tipo "software" — Software Gerencial. Planos (campo plano):',
    planos,
    'Regras de preço: trimestral tem o mesmo valor mensal do plano; anual sai R$ ' + DESCONTO_ANUAL + ' mais barato por mês; adesão de R$ ' + ADESAO_FIXA + ' só no mensal. O desconto é um valor único em R$ por mês, que abate igual em todas as modalidades.',
    'Produtos adicionais do Software Gerencial (campo adicionais, pelo id):',
    adicionais,
    'CRM: ' + AV_TABELA.crmInclusos + ' usuários inclusos e R$ ' + AV_TABELA.crmExtra + ' por usuário a mais (informe crm_usuarios). Com o Software Gerencial o setup do CRM é bonificado.',
    '',
    'Tipo "avulso" — quando o cliente NÃO leva o Software Gerencial, só um destes como produto principal (campo avulso_plano):',
    '- "crm": CRM com WhatsApp, R$ ' + AV_TABELA.crmBase + '/mês com ' + AV_TABELA.crmInclusos + ' usuários (+R$ ' + AV_TABELA.crmExtra + ' por extra) e setup de R$ ' + AV_TABELA.crmSetup + '. Pós-pago, só boleto, sem modalidades. Adicionais possíveis: "nfe" (R$ ' + AV_TABELA.nfMensal + ') e "ia".',
    '- "nf": Nota Fiscal, R$ ' + AV_TABELA.nfMensal + ' mensal / R$ ' + AV_TABELA.nfTrimestral + ' trimestral / R$ ' + AV_TABELA.nfAnual + ' anual (por mês). Adicionais possíveis: "renave" (R$ ' + AV_TABELA.renave + '), "cnpj" (R$ ' + AV_TABELA.cnpjUnit + ' por CNPJ, informe cnpj_qtd) e "crm" (informe crm_usuarios).',
    '- "ia": agente de IA no WhatsApp, R$ ' + AV_TABELA.iaMensal + '/mês até ' + AV_TABELA.iaLeads + ' leads, R$ ' + AV_TABELA.iaExcedente + ' por lead excedente. Sem fidelidade, sem adicionais.',
    'Os adicionais do avulso vão no campo avulso_adicionais.',
    '',
    'Forma de pagamento: "cartao" (cartão de crédito), "boleto" (boleto/PIX) ou "ambos" (oferecer as duas).',
    'Modalidades: mensal, trimestral e anual.'
  ].join('\n');
}

function iaInstrucoes() {
  return [
    'Você é assistente do time comercial da Revenda Mais. Vai receber a transcrição de uma reunião de vendas com um lojista e deve devolver, no JSON pedido:',
    '1) "proposta": os dados para montar a proposta comercial com o que foi alinhado na reunião;',
    '2) "lead" e "crm": a documentação do lead para o CRM;',
    '3) "proximos_passos", "pontos_em_aberto" e "observacoes";',
    '4) "feedback": avaliação da condução da reunião pelo vendedor da Revenda Mais, para ele melhorar as próximas.',
    '',
    'Regras:',
    '- Use só o que aparece na transcrição. Não invente nomes, números, valores, cargos nem combinados. Se algo não foi dito, deixe o texto vazio ("") ou o número 0.',
    '- Proposta: escolha o tipo, o plano e os adicionais que foram apresentados ou combinados. Se o plano não foi dito mas o número de veículos foi, escolha o menor plano que comporte o estoque e diga isso em "observacoes".',
    '- veiculos e usuarios: só se o número foi dito; senão "" (aí vale o padrão do plano).',
    '- modalidades: marque só as que fazem sentido mandar. Se o cliente descartou alguma (ex.: "mensal não me interessa") ou o vendedor combinou mandar só uma, desmarque as outras. Se nada foi dito, marque as três.',
    '- desconto: valor em R$ por mês, só se foi combinado um desconto. Se o desconto foi dito em %, converta sobre o valor mensal do plano e explique em "observacoes".',
    '- condicoes_especiais: combinados que não cabem nos outros campos (cortesia, prazo de implantação, condição de pagamento da adesão etc.), uma por linha. Vazio se não houve.',
    '- Ficha do CRM: texto corrido, objetivo, em português, 1 a 4 frases por campo, do ponto de vista do vendedor. Cite números e falas importantes do cliente quando houver.',
    '  dor_principal: qual o principal problema do cliente. processo_atual: como ele resolve isso hoje (sistema, planilha, papel...). impacto: o impacto dessa dor no negócio. solucao_apresentada: o que foi apresentado para ajudar. contexto_empresa: tempo de mercado e momento atual da operação. decisor: quem aprova a contratação (nome e papel). influenciador: quem influencia a decisão. valor_agregado: qual orientação, dica ou melhoria o vendedor entregou na reunião.',
    '- Campo da ficha que não apareceu na conversa: deixe "" (o sistema marca como não identificado). Não preencha com suposição.',
    '- pontos_em_aberto: o que faltou descobrir ou confirmar (ex.: quem é o decisor, prazo de decisão), em frases curtas — servem de roteiro para o próximo contato.',
    '- proximos_passos: o que ficou combinado para depois da reunião (envio da proposta, nova reunião, data).',
    '- observacoes: avisos para o vendedor conferir na proposta (escolhas que você teve que fazer). Vazio se não houver.',
    '',
    'Feedback (use SPIN Selling, Gap Selling e boas práticas de venda consultiva; escreva para o vendedor, em "você"; direto e construtivo, sem elogio vazio):',
    '- tipo_texto: "transcricao" se o texto traz a conversa (falas do vendedor e do cliente); "resumo" se é um relato ou ditado do vendedor sobre a reunião. No resumo, avalie só o que dá para saber e diga isso no campo resumo.',
    '- nota: de 0 a 10 para a condução (investigação, conexão da solução com a dor, clareza da proposta, próximo passo combinado). Seja exigente: 9 ou 10 só para reunião exemplar.',
    '- ritmo: "prolixo" se o vendedor falou demais, apresentou funcionalidades sem ligar à dor ou se repetiu; "raso" se investigou pouco, foi cedo para preço ou não explorou implicações; senão "equilibrado".',
    '- resumo: 2 ou 3 frases, como um gestor comercial descreveria a reunião.',
    '- spin: situacao, problema, implicacao e necessidade, 1 ou 2 frases cada: o que o vendedor perguntou e o que faltou perguntar.',
    '- gap: estado_atual (entendeu como a loja opera hoje?), estado_futuro (onde o cliente quer chegar?), impacto (mediu o tamanho do problema e a causa?). 1 ou 2 frases cada.',
    '- pontos_fortes: até 3, específicos, citando o que aconteceu na reunião.',
    '- pontos_melhoria: até 5, acionáveis: o que fazer diferente e, quando couber, um exemplo de frase ou pergunta.',
    '- perguntas_que_faltaram: até 5 perguntas prontas para usar no próximo contato com este cliente.',
    '- dica_proxima_reuniao: 1 frase com a principal mudança para a próxima reunião.',
    '',
    iaCatalogo()
  ].join('\n');
}

// Formato da resposta (structured outputs: o Claude devolve exatamente este JSON)
function iaSchema() {
  const str = { type: 'string' };
  const obj = function (props) {
    return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
  };
  const crm = {};
  CRM_CAMPOS.forEach(function (c) { crm[c.id] = str; });
  const lead = {};
  CRM_LEAD.forEach(function (c) { lead[c.id] = str; });
  return obj({
    proposta: obj({
      cliente: str,
      telefone: str,
      tipo: { type: 'string', enum: ['software', 'avulso'] },
      plano: { type: 'string', enum: Object.keys(PLANOS) },
      veiculos: str,
      usuarios: str,
      adicionais: { type: 'array', items: obj({ id: { type: 'string', enum: ADICIONAIS.map(function (a) { return a.id; }) }, valor_mensal: { type: 'number' } }) },
      crm_usuarios: { type: 'integer' },
      avulso_plano: { type: 'string', enum: ['crm', 'nf', 'ia'] },
      avulso_adicionais: { type: 'array', items: { type: 'string', enum: ['nfe', 'ia', 'renave', 'cnpj', 'crm'] } },
      cnpj_qtd: { type: 'integer' },
      desconto: { type: 'number' },
      forma_pagamento: { type: 'string', enum: ['cartao', 'boleto', 'ambos'] },
      modalidades: obj({ mensal: { type: 'boolean' }, trimestral: { type: 'boolean' }, anual: { type: 'boolean' } }),
      condicoes_especiais: str
    }),
    lead: obj(lead),
    crm: obj(crm),
    proximos_passos: str,
    pontos_em_aberto: { type: 'array', items: str },
    observacoes: str,
    feedback: obj({
      tipo_texto: { type: 'string', enum: ['transcricao', 'resumo'] },
      nota: { type: 'integer' },
      ritmo: { type: 'string', enum: ['raso', 'equilibrado', 'prolixo'] },
      resumo: str,
      spin: obj({ situacao: str, problema: str, implicacao: str, necessidade: str }),
      gap: obj({ estado_atual: str, estado_futuro: str, impacto: str }),
      pontos_fortes: { type: 'array', items: str },
      pontos_melhoria: { type: 'array', items: str },
      perguntas_que_faltaram: { type: 'array', items: str },
      dica_proxima_reuniao: str
    })
  });
}

function iaTxt(v) {
  return String(v == null ? '' : v).trim();
}

// A ficha inteira num texto só (mesmo formato que vai para o CRM)
function crmFichaTexto(r) {
  const lead = r.lead || {}, crm = r.crm || {};
  const blocos = CRM_CAMPOS.map(function (c) { return c.titulo + '\n' + (iaTxt(crm[c.id]) || IA_NAO_IDENTIFICADO); });
  if (iaTxt(r.proximos_passos)) blocos.push('Próximos Passos\n' + iaTxt(r.proximos_passos));
  const contato = CRM_LEAD.filter(function (c) { return iaTxt(lead[c.id]); }).map(function (c) { return c.titulo + ': ' + iaTxt(lead[c.id]); });
  if (contato.length) blocos.push('Dados do Lead\n' + contato.join('\n'));
  return blocos.join('\n\n');
}
