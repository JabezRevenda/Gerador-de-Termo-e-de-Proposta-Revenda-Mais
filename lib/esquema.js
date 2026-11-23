// Validação do JSON devolvido pela IA contra o JSON Schema pedido (o subconjunto que usamos:
// object, array, string, number, integer, boolean, enum, required, additionalProperties: false).
// Devolve a lista de problemas encontrados — vazia quando está tudo certo.
export function validarSchema(schema, valor, caminho) {
  caminho = caminho || 'resposta';
  const erros = [];
  const tipo = schema.type;
  if (schema.enum && schema.enum.indexOf(valor) === -1) {
    erros.push(caminho + ' fora das opções');
    return erros;
  }
  if (tipo === 'object') {
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return [caminho + ' deveria ser objeto'];
    const props = schema.properties || {};
    (schema.required || []).forEach(function (k) {
      if (!(k in valor)) erros.push(caminho + '.' + k + ' faltando');
    });
    Object.keys(valor).forEach(function (k) {
      if (props[k]) erros.push.apply(erros, validarSchema(props[k], valor[k], caminho + '.' + k));
      else if (schema.additionalProperties === false) erros.push(caminho + '.' + k + ' não esperado');
    });
  } else if (tipo === 'array') {
    if (!Array.isArray(valor)) return [caminho + ' deveria ser lista'];
    valor.forEach(function (v, i) { erros.push.apply(erros, validarSchema(schema.items || {}, v, caminho + '[' + i + ']')); });
  } else if (tipo === 'string') {
    if (typeof valor !== 'string') erros.push(caminho + ' deveria ser texto');
  } else if (tipo === 'number') {
    if (typeof valor !== 'number' || !isFinite(valor)) erros.push(caminho + ' deveria ser número');
  } else if (tipo === 'integer') {
    if (!Number.isInteger(valor)) erros.push(caminho + ' deveria ser inteiro');
  } else if (tipo === 'boolean') {
    if (typeof valor !== 'boolean') erros.push(caminho + ' deveria ser verdadeiro/falso');
  }
  return erros;
}

// Atalho para montar objetos "fechados" (todas as chaves obrigatórias, nada além delas),
// o formato que OpenAI e Anthropic exigem no modo estrito
export function objeto(props) {
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
}
