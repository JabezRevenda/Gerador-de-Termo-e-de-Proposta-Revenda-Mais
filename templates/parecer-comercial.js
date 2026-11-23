// Modelo do PARECER COMERCIAL (Documento A) — para o vendedor preencher o CRM.
// Para personalizar: mude títulos, orientações e a ordem das seções aqui, ou crie outro arquivo
// no mesmo formato e aponte em lib/documentos.js. O formato da resposta da IA, o texto e o
// e-mail são montados a partir desta lista — não precisa mexer em mais nada.
//
// Tipos de seção:
//   texto  → um parágrafo
//   lista  → itens simples
//   itens  → itens com situação: acordado / proposto / solicitado / mencionado
//   campos → bloco de campos fixos (ex.: o formato do CRM)
export default {
  id: 'parecer_comercial',
  titulo: 'Parecer comercial',
  orientacao: 'Parecer interno para o vendedor registrar a reunião no CRM. Objetivo, factual, do ponto de vista do vendedor.',
  secaoPendencias: 'pendencias',
  secoes: [
    { id: 'empresa', tipo: 'texto', titulo: 'Empresa', orientacao: 'Nome da empresa/loja do cliente, cidade e segmento, se ditos.' },
    { id: 'contato', tipo: 'texto', titulo: 'Contato', orientacao: 'Nome, cargo, telefone e e-mail do contato principal do cliente, só o que foi dito.' },
    { id: 'participantes', tipo: 'lista', titulo: 'Participantes da reunião', orientacao: 'Cada participante com o papel na reunião (ex.: "Carlos Silva — sócio do cliente", "Ana — consultora Revenda Mais").' },
    { id: 'contexto', tipo: 'texto', titulo: 'Contexto e situação atual do cliente', orientacao: 'Tempo de mercado, porte, momento da operação, como trabalha hoje (sistemas, planilhas, equipe).' },
    { id: 'necessidades', tipo: 'lista', titulo: 'Necessidades identificadas' },
    { id: 'dores', tipo: 'lista', titulo: 'Principais dores', orientacao: 'Problemas concretos relatados pelo cliente, com números e falas quando houver.' },
    { id: 'solucoes', tipo: 'itens', titulo: 'Soluções discutidas', orientacao: 'Produtos, planos e funcionalidades discutidos, com a situação de cada um.' },
    { id: 'objecoes', tipo: 'lista', titulo: 'Objeções e dúvidas', orientacao: 'Objeções, receios e perguntas do cliente, e como foram respondidas (ou que ficaram sem resposta).' },
    { id: 'valores', tipo: 'itens', titulo: 'Valores apresentados', orientacao: 'Cada valor exatamente como foi falado (preço, desconto, adesão, parcelas), com a situação. Nunca calcule nem complete valores.' },
    { id: 'interesse', tipo: 'texto', titulo: 'Interesse demonstrado', orientacao: 'Nível de interesse (alto, médio, baixo ou não identificável) e as falas/sinais que sustentam essa leitura.' },
    { id: 'proximos_passos', tipo: 'itens', titulo: 'Próximos passos', orientacao: 'O que ficou combinado para depois da reunião, com responsável e data quando ditos.' },
    { id: 'pendencias', tipo: 'lista', titulo: 'Pendências', orientacao: 'O que faltou descobrir ou confirmar (decisor, prazo de decisão, orçamento, dados cadastrais...). Serve de roteiro para o próximo contato.' },
    {
      id: 'resumo_crm', tipo: 'campos', titulo: 'Resumo comercial para o CRM',
      orientacao: 'Texto corrido e objetivo, 1 a 4 frases por campo, pronto para colar no CRM.',
      campos: [
        { id: 'dor_principal',       rotulo: '🎯 Dor Principal',       orientacao: 'Qual o principal problema do cliente?' },
        { id: 'processo_atual',      rotulo: '🔄 Processo Atual',      orientacao: 'Como ele resolve isso hoje?' },
        { id: 'impacto',             rotulo: '📈 Impacto',             orientacao: 'Qual o impacto dessa dor no negócio?' },
        { id: 'solucao_apresentada', rotulo: '💡 Solução Apresentada', orientacao: 'O que foi apresentado para ajudar?' },
        { id: 'contexto_empresa',    rotulo: '🏢 Contexto da Empresa', orientacao: 'Tempo de mercado e momento atual da operação.' },
        { id: 'decisor',             rotulo: '👤 Decisor',             orientacao: 'Quem aprova a contratação?' },
        { id: 'influenciador',       rotulo: '🤝 Influenciador',       orientacao: 'Quem influencia a decisão?' },
        { id: 'valor_agregado',      rotulo: '⭐ Valor Agregado',      orientacao: 'Qual orientação, dica ou melhoria foi entregue?' }
      ]
    }
  ]
};
