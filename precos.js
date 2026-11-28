// Tabelas da Revenda Mais usadas pelo hub (index.html), pela calculadora (calculadora.html)
// e pelo painel do gestor (gestor.html). Mudou um preço ou um peso? Mude só aqui.

const RECURSOS_PADRAO = [
  'Gestão completa do estoque',
  'Módulo de avaliação do veículo',
  'Gestão financeira da loja',
  'Cadastro fácil pela placa',
  'Módulo de controle de serviços',
  'Sinal de Negócio',
  'Integrador para portais de anúncio',
  'Controle de Despachante',
  'Relatórios',
  'Guarda de arquivos',
  'Módulo de refinanciamentos',
  'Controle de Comissões',
  'Geração de contratos'
];

// Configuração dos planos — altere aqui veículos, usuários, valor e o que não entra
const ADESAO_FIXA = 1000;
const DESCONTO_ANUAL = 50;   // quanto o valor anual fica abaixo do mensal
const PLANOS = {
  '0.5': { veiculos: 25,  usuarios: 5,  valor: '600,00',   desmarcados: ['Gestão financeira da loja'] },
  '1.0': { veiculos: 50,  usuarios: 10, valor: '800,00',   desmarcados: [] },
  '2.0': { veiculos: 100, usuarios: 15, valor: '1.000,00', desmarcados: [] },
  '3.0': { veiculos: 150, usuarios: 20, valor: '1.300,00', desmarcados: [] },
  // Integrador: só conecta aos portais de anúncio e sobe os carros (cadastro + fotos)
  'integrador': { nome: 'Integrador', linha: 'Integrador de anúncios', veiculos: 300, usuarios: '', valor: '400,00',
    desmarcados: RECURSOS_PADRAO.filter(function (r) {
      return r !== 'Integrador para portais de anúncio' && r !== 'Cadastro fácil pela placa';
    }) }
};


// Tabela de preços fixa do fluxo avulso — não editável na tela, só via desconto
const AV_TABELA = {
  crmBase: 500, crmInclusos: 3, crmExtra: 100, crmSetup: 390,
  nfMensal: 400, nfTrimestral: 400, nfAnual: 350,
  renave: 30,
  iaMensal: 996, iaLeads: 500, iaExcedente: 5,   // IA: pacote de leads, sem fidelidade
  cnpjUnit: 100   // valor de tabela por CNPJ adicional (o campo continua editável na tela)
};
function avCrmCalc(usuarios) {
  const u = Math.max(0, parseInt(usuarios, 10) || 0);
  const extra = Math.max(0, u - AV_TABELA.crmInclusos);
  return { usuarios: u, extra: extra, valor: AV_TABELA.crmBase + extra * AV_TABELA.crmExtra };
}

// Produtos adicionais — para incluir um novo módulo fixo, basta acrescentar aqui
const ADICIONAIS = [
  { id: 'crm',      nome: 'CRM com WhatsApp',     desc: '3 usuários inclusos', fora: true, usuarios: true, padrao: 500,
    obs: 'O CRM é cobrado separadamente, via boleto, na virada de cada mês, pois a cobrança é pós-paga. Cada usuário adicional possui o custo de R$ 100,00 por mês. Setup de R$ 390,00 bonificado na contratação com o Software Gerencial.' },
  // padrao: valor de tabela preenchido ao marcar (continua editável)
  { id: 'ia',       nome: 'IA',                   desc: 'Agente de pré-vendas no WhatsApp — até 500 leads/mês', padrao: 996, fora: true,
    obs: 'Cobrada à parte, via boleto mensal. R$ 996,00 por mês para atender até 500 leads; leads acima desse volume no mês são cobrados a R$ 5,00 cada. Sem fidelidade — a contratação é formalizada mediante assinatura do termo.' },
  { id: 'nf',       nome: 'Nota Fiscal',          desc: 'Emissor de nota fiscal eletrônica', dual: true, padrao: 400 },   // anual: R$ 50 a menos
  { id: 'cnpj',     nome: 'CNPJ Adicional',       desc: 'Emita e receba notas em CNPJs distintos — R$ 100,00 por CNPJ/mês', padrao: 100 },
  { id: 'assin',    nome: 'Assinatura Eletrônica',desc: 'Assine documentos digitalmente', padrao: 100 },
  { id: 'vistoria', nome: 'Vistoria',             desc: 'Padronize e agilize suas vistorias', padrao: 200 },
  { id: 'renave',   nome: 'Renave',               desc: 'Transferência eletrônica de veículos', padrao: 30 },
  { id: 'integra',  nome: 'Integrações',          desc: 'Conexão com sistemas e portais parceiros', padrao: 100 },
  { id: 'concil',   nome: 'Conciliação Bancária', desc: 'Gestão e controle financeiro', padrao: 100 }
];

// Controle do mês: linhas da calculadora de metas e o peso de cada uma no resultado (somam 100%)
const CTL_LINHAS = [
  { k: 'novas', nome: 'Lojas novas', peso: 0.5 },
  { k: 'ia',    nome: 'IA',          peso: 0.1 },
  { k: 'renov', nome: 'Renovações',  peso: 0.2 },
  { k: 'reun',  nome: 'Reuniões',    peso: 0.2 }
];
