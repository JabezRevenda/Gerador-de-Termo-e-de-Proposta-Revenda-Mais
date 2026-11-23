// Modelo da PROPOSTA COMERCIAL (Documento B) — rascunho para o vendedor revisar antes de mandar.
// Mesmo formato do parecer (ver templates/parecer-comercial.js): para personalizar, mude as
// seções aqui; o formato da resposta da IA, o texto e o e-mail acompanham.
export default {
  id: 'proposta_comercial',
  titulo: 'Proposta comercial (rascunho)',
  orientacao: 'Rascunho de proposta formal dirigida ao cliente, com linguagem comercial profissional. ' +
    'Registra apenas o que foi conversado: o que não foi acordado aparece como proposto/solicitado ou pendente — nunca como compromisso.',
  secaoPendencias: 'pendencias',
  secoes: [
    { id: 'empresa', tipo: 'texto', titulo: 'Identificação da empresa', orientacao: 'Razão social/nome da loja, cidade e contato do cliente, só o que foi dito.' },
    { id: 'contexto', tipo: 'texto', titulo: 'Contextualização', orientacao: 'Breve contexto do cliente e do motivo da conversa, em tom de proposta.' },
    { id: 'objetivo', tipo: 'texto', titulo: 'Objetivo da contratação', orientacao: 'O que o cliente quer resolver/alcançar com a contratação, segundo a reunião.' },
    { id: 'escopo', tipo: 'itens', titulo: 'Escopo discutido' },
    { id: 'servicos', tipo: 'itens', titulo: 'Serviços e funcionalidades apresentados' },
    { id: 'entregaveis', tipo: 'itens', titulo: 'Entregáveis', orientacao: 'Entregas concretas citadas (implantação, treinamento, integrações, migração de dados...).' },
    { id: 'investimento', tipo: 'itens', titulo: 'Investimento e condições comerciais', orientacao: 'Valores, descontos, adesão, forma e prazo de pagamento, fidelidade — exatamente como falados, com a situação de cada um. Nunca calcule, arredonde ou complete valores.' },
    { id: 'prazos', tipo: 'itens', titulo: 'Prazos mencionados', orientacao: 'Prazos de implantação, de decisão, de validade da proposta etc.' },
    { id: 'responsabilidades', tipo: 'itens', titulo: 'Responsabilidades e próximos passos', orientacao: 'O que cabe a cada parte e o que foi combinado como próximo passo.' },
    { id: 'pendencias', tipo: 'lista', titulo: 'Informações pendentes de confirmação', orientacao: 'Tudo que precisa ser confirmado com o cliente antes de enviar a proposta (valores, plano, prazos, dados cadastrais...).' }
  ]
};
