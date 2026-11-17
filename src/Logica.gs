/**
 * Lógica pura do Painel de Atendimento.
 *
 * Nada aqui chama serviços do Google (SpreadsheetApp, LockService...).
 * O mesmo código roda em três lugares:
 *   - no Apps Script (Codigo.gs usa estas funções);
 *   - no navegador (Painel.html recebe o código-fonte via codigoLogicaParaPainel_);
 *   - no Node, nos testes (test/logica.test.js).
 */

var STATUS = {
  PENDENTE: 'Pendente',
  EM_ATENDIMENTO: 'Em atendimento',
  CONSULTADO: 'Consultado',
  SEM_MARGEM: 'Sem margem',
  PULADO: 'Pulado'
};

var LISTA_STATUS = [STATUS.PENDENTE, STATUS.EM_ATENDIMENTO, STATUS.CONSULTADO, STATUS.SEM_MARGEM, STATUS.PULADO];

/** Status que tiram o cliente da tela. */
var STATUS_FINAIS = [STATUS.CONSULTADO, STATUS.SEM_MARGEM, STATUS.PULADO];

/** Campos de cadastro vindos das bases (os únicos que Atualizar fila pode completar). */
var CAMPOS_CLIENTE = ['nome', 'cpf', 'matricula', 'telefone', 'orgao'];

/** Títulos tentados quando a coluna da base não foi configurada. */
var TITULOS_PADRAO = {
  nome: ['Nome', 'Nome completo', 'Nome do cliente', 'Cliente', 'Servidor', 'Nome do servidor'],
  cpf: ['CPF', 'CPF do cliente'],
  matricula: ['Matrícula', 'Matricula', 'Mat'],
  telefone: ['Telefone', 'Celular', 'Fone', 'WhatsApp', 'Contato', 'Telefone 1'],
  orgao: ['Órgão', 'Orgao', 'Secretaria', 'Lotação', 'Instituição']
};

/** Minúsculas, sem acentos, espaços repetidos viram um só, sem espaços nas pontas. */
function normalizar_(texto) {
  return String(texto == null ? '' : texto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Para comparar títulos de coluna: como normalizar_, e também ignora pontuação ("Ativo?" = "ativo"). */
function chaveTitulo_(texto) {
  return normalizar_(texto).replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function soDigitos_(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '');
}

/**
 * CPF só com dígitos, sempre com 11 posições (repõe zeros à esquerda que a planilha comeu).
 * Vazio se não houver dígitos. Com mais de 11 dígitos devolve como veio, para ela conferir.
 */
function formatarCpf_(valor) {
  var d = typeof valor === 'number' ? String(Math.round(valor)) : soDigitos_(valor);
  if (!d || /^0+$/.test(d)) return '';
  if (d.length > 11) return d;
  while (d.length < 11) d = '0' + d;
  return d;
}

/** "01234567890" -> "012.345.678-90" (só para exibir). */
function mostrarCpf_(cpf) {
  var d = soDigitos_(cpf);
  if (d.length !== 11) return String(cpf == null ? '' : cpf);
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
}

/**
 * Converte o que ela digitar em número. Aceita:
 *   "R$ 1.234,56"  "1234,56"  "1.234"  (formato brasileiro)
 *   "1234.56"  "1,234.56"            (formato com ponto decimal)
 * Regra para ponto sem vírgula: "1.234" (exatamente 3 dígitos depois de um ponto) ou
 * vários pontos são milhar; caso contrário o ponto é decimal ("1234.5").
 * Devolve null para vazio ou texto que não é número.
 */
function numero_(valor) {
  if (typeof valor === 'number') return isFinite(valor) ? valor : null;
  var s = String(valor == null ? '' : valor).replace(/R\$/gi, '').replace(/\s/g, '');
  if (!s) return null;
  var negativo = false;
  if (s.charAt(0) === '-') { negativo = true; s = s.slice(1); }
  var virgula = s.lastIndexOf(',');
  var ponto = s.lastIndexOf('.');
  if (virgula >= 0 && ponto >= 0) {
    if (virgula > ponto) s = s.replace(/\./g, '').replace(',', '.');  // 1.234,56
    else s = s.replace(/,/g, '');                                       // 1,234.56
  } else if (virgula >= 0) {
    s = s.replace(',', '.');                                            // 1234,56
  } else if (ponto >= 0) {
    var pontos = s.split('.').length - 1;
    if (pontos > 1 || /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, ''); // 1.234 / 1.234.567
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  var n = parseFloat(s);
  return negativo ? -n : n;
}

function arredondar2_(n) {
  return Math.round(n * 100) / 100;
}

/** 1234.5 -> "R$ 1.234,50". Vazio para null/NaN. */
function formatarMoeda_(n) {
  if (n == null || n === '' || !isFinite(n)) return '';
  var negativo = n < 0;
  var centavos = Math.round(Math.abs(n) * 100);
  var inteiro = String(Math.floor(centavos / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  var cent = String(centavos % 100);
  if (cent.length < 2) cent = '0' + cent;
  return (negativo ? '-' : '') + 'R$ ' + inteiro + ',' + cent;
}

/** Limpa um cliente lido de uma base: textos aparados, CPF com 11 dígitos. */
function limparCliente_(c) {
  c = c || {};
  function texto(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  return {
    nome: texto(c.nome),
    cpf: formatarCpf_(c.cpf),
    matricula: texto(c.matricula),
    telefone: texto(c.telefone),
    orgao: texto(c.orgao)
  };
}

/**
 * Chave de deduplicação: CPF; sem CPF, matrícula; sem os dois, nome + base.
 * Matrícula é comparada sem pontuação e sem zeros à esquerda.
 * Devolve '' quando não há nada que identifique o cliente.
 */
function chaveCliente_(cliente, nomeBase) {
  var cpf = formatarCpf_(cliente && cliente.cpf);
  if (cpf) return 'CPF:' + cpf;
  var mat = normalizar_(cliente && cliente.matricula).replace(/[^a-z0-9]/g, '').replace(/^0+/, '');
  if (mat) return 'MAT:' + mat;
  var nome = normalizar_(cliente && cliente.nome);
  if (!nome) return '';
  return 'NOME:' + nome + '|' + normalizar_(nomeBase);
}

/** Linha nova da Fila para um cliente que ainda não existe. */
function novaLinhaFila_(chave, cliente, origem) {
  return {
    chave: chave,
    nome: cliente.nome,
    cpf: cliente.cpf,
    matricula: cliente.matricula,
    telefone: cliente.telefone,
    orgao: cliente.orgao,
    origem: origem || '',
    status: STATUS.PENDENTE,
    margemEmprestimo: '',
    margemCartao: '',
    melhorEmprestimo: '',
    melhorCartao: '',
    atualizadoEm: '',
    observacao: ''
  };
}

/**
 * Junta os clientes lidos das bases com a Fila existente.
 *
 * @param {Object[]} existentes linhas atuais da Fila (objetos com chave e demais campos)
 * @param {Object[]} entradas clientes lidos das bases: {nome, cpf, matricula, telefone, orgao, origem}
 * @return {{linhas: Object[], novos: number, completados: number, ignorados: number}}
 *   linhas: a Fila inteira, na mesma ordem, com os novos no final.
 *   Linhas existentes só ganham campos de cadastro que estavam vazios;
 *   status, margens, propostas, datas e observações nunca são tocados.
 */
function mesclarFila_(existentes, entradas) {
  var linhas = (existentes || []).map(function (l) {
    var copia = {};
    for (var k in l) if (Object.prototype.hasOwnProperty.call(l, k)) copia[k] = l[k];
    return copia;
  });
  var indice = {};
  linhas.forEach(function (l, i) {
    if (l.chave && !Object.prototype.hasOwnProperty.call(indice, l.chave)) indice[l.chave] = i;
  });

  var novos = 0, completados = 0, ignorados = 0;
  var completadas = {};

  (entradas || []).forEach(function (e) {
    var cliente = limparCliente_(e);
    var chave = chaveCliente_(cliente, e && e.origem);
    if (!chave) { ignorados++; return; }

    if (Object.prototype.hasOwnProperty.call(indice, chave)) {
      var i = indice[chave];
      var linha = linhas[i];
      var mudou = false;
      CAMPOS_CLIENTE.forEach(function (campo) {
        var atual = String(linha[campo] == null ? '' : linha[campo]).trim();
        if (!atual && cliente[campo]) { linha[campo] = cliente[campo]; mudou = true; }
      });
      if (mudou && !completadas[i]) { completadas[i] = true; completados++; }
      return;
    }

    linhas.push(novaLinhaFila_(chave, cliente, e && e.origem));
    indice[chave] = linhas.length - 1;
    novos++;
  });

  return { linhas: linhas, novos: novos, completados: completados, ignorados: ignorados };
}

/**
 * Índice do cliente a mostrar: o primeiro "Em atendimento"; se não houver, o primeiro "Pendente".
 * precisaMarcar = true quando é um Pendente que deve virar "Em atendimento".
 */
function escolherAtual_(linhas) {
  var i;
  for (i = 0; i < linhas.length; i++) {
    if (linhas[i].chave && linhas[i].status === STATUS.EM_ATENDIMENTO) return { indice: i, precisaMarcar: false };
  }
  for (i = 0; i < linhas.length; i++) {
    var st = linhas[i].status;
    if (linhas[i].chave && (st === STATUS.PENDENTE || st === '' || st == null)) return { indice: i, precisaMarcar: true };
  }
  return { indice: -1, precisaMarcar: false };
}

/**
 * Números do topo do painel.
 * naFila: Pendente + Em atendimento. feitosHoje: Consultado ou Sem margem com data de hoje.
 * @param {function(*): string} formatarDia converte o valor de "Atualizado em" em "yyyy-MM-dd" ('' se não for data)
 */
function resumoDaFila_(linhas, hoje, formatarDia) {
  var r = { naFila: 0, feitosHoje: 0, puladosHoje: 0 };
  linhas.forEach(function (l) {
    if (!l.chave) return;
    var st = l.status || STATUS.PENDENTE;
    if (st === STATUS.PENDENTE || st === STATUS.EM_ATENDIMENTO) r.naFila++;
    else if (l.atualizadoEm && formatarDia(l.atualizadoEm) === hoje) {
      if (st === STATUS.CONSULTADO || st === STATUS.SEM_MARGEM) r.feitosHoje++;
      else if (st === STATUS.PULADO) r.puladosHoje++;
    }
  });
  return r;
}

/**
 * Acha colunas pelo título.
 * @param {Array} cabecalho valores da linha de títulos
 * @param {Object<string, string[]>} candidatos campo -> títulos aceitos, em ordem de preferência
 * @return {Object<string, number>} campo -> índice (0-based), ou -1 se não achou
 */
function mapearColunas_(cabecalho, candidatos) {
  var titulos = (cabecalho || []).map(chaveTitulo_);
  var mapa = {};
  Object.keys(candidatos).forEach(function (campo) {
    mapa[campo] = -1;
    var lista = candidatos[campo] || [];
    for (var j = 0; j < lista.length && mapa[campo] < 0; j++) {
      var alvo = chaveTitulo_(lista[j]);
      if (alvo) mapa[campo] = titulos.indexOf(alvo);
    }
  });
  return mapa;
}

/**
 * Linha de títulos de uma base: entre as primeiras maxLinhas, a que casa mais colunas
 * (algumas planilhas têm título ou linhas em branco antes do cabeçalho). -1 se nenhuma casa.
 */
function encontrarLinhaCabecalho_(valores, candidatos, maxLinhas) {
  var limite = Math.min((valores || []).length, maxLinhas || 10);
  var melhor = -1, melhorQtd = 0;
  for (var i = 0; i < limite; i++) {
    var mapa = mapearColunas_(valores[i], candidatos);
    var qtd = Object.keys(mapa).filter(function (k) { return mapa[k] >= 0; }).length;
    if (qtd > melhorQtd) { melhor = i; melhorQtd = qtd; }
  }
  return melhor;
}

function produtoNormalizado_(valor) {
  var p = chaveTitulo_(valor);
  if (p.indexOf('emprest') === 0) return 'emprestimo';
  if (p.indexOf('cartao') >= 0 || p.indexOf('saque') >= 0) return 'cartao';
  return p;
}

/**
 * Lê a aba Coeficientes (valores com a linha de títulos na primeira linha).
 * Colunas achadas pelo título: Banco, Produto, Prazo, Cálculo, Fator, Ativo?.
 * Ativo vazio conta como SIM; só NÃO/N/FALSE/0 desliga a linha.
 */
function lerCoeficientes_(valores) {
  if (!valores || !valores.length) return [];
  var col = mapearColunas_(valores[0], {
    banco: ['Banco'], produto: ['Produto'], prazo: ['Prazo'],
    calculo: ['Cálculo', 'Calculo', 'Tipo'], fator: ['Fator', 'Coeficiente'], ativo: ['Ativo?', 'Ativo']
  });
  if (col.banco < 0 || col.fator < 0) return [];
  var lista = [];
  for (var i = 1; i < valores.length; i++) {
    var v = valores[i];
    var banco = String(v[col.banco] == null ? '' : v[col.banco]).trim();
    var fator = numero_(v[col.fator]);
    if (!banco || fator == null) continue;
    var ativo = col.ativo < 0 ? true : ['nao', 'n', 'false', '0', 'inativo'].indexOf(chaveTitulo_(v[col.ativo])) < 0;
    if (v[col.ativo] === false) ativo = false;
    var calc = col.calculo < 0 ? '' : chaveTitulo_(v[col.calculo]);
    lista.push({
      banco: banco,
      produto: col.produto < 0 ? 'emprestimo' : produtoNormalizado_(v[col.produto]),
      prazo: col.prazo < 0 ? '' : String(v[col.prazo] == null ? '' : v[col.prazo]).trim(),
      calculo: calc.indexOf('mult') === 0 ? 'multiplicador' : 'coeficiente',
      fator: fator,
      ativo: ativo
    });
  }
  return lista;
}

/**
 * Melhor valor liberado por banco para um produto, em ordem decrescente.
 * Coeficiente: margem ÷ fator. Multiplicador: margem × fator.
 */
function melhoresPorBanco_(coeficientes, produto, margem) {
  if (!(margem > 0)) return [];
  var melhor = {};
  (coeficientes || []).forEach(function (c) {
    if (!c.ativo || c.produto !== produto || !(c.fator > 0)) return;
    var valor = arredondar2_(c.calculo === 'multiplicador' ? margem * c.fator : margem / c.fator);
    var chave = normalizar_(c.banco);
    if (!melhor[chave] || valor > melhor[chave].valor) {
      melhor[chave] = { banco: c.banco, prazo: c.prazo, valor: valor, calculo: c.calculo };
    }
  });
  return Object.keys(melhor).map(function (k) { return melhor[k]; }).sort(function (a, b) {
    return b.valor - a.valor || (a.banco < b.banco ? -1 : a.banco > b.banco ? 1 : 0);
  });
}

/** Ranking dos dois produtos. As margens podem vir como texto digitado ("R$ 1.234,56"). */
function simular_(coeficientes, margemEmprestimo, margemCartao) {
  return {
    emprestimo: melhoresPorBanco_(coeficientes, 'emprestimo', numero_(margemEmprestimo)),
    cartao: melhoresPorBanco_(coeficientes, 'cartao', numero_(margemCartao))
  };
}

/** Texto gravado em "Melhor empréstimo"/"Melhor cartão": "Banco — R$ 1.234,56 (84x)". */
function descreverMelhor_(item) {
  if (!item) return '';
  var prazo = String(item.prazo == null ? '' : item.prazo).trim();
  if (/^\d+$/.test(prazo)) prazo += 'x';
  return item.banco + ' — ' + formatarMoeda_(item.valor) + (prazo ? ' (' + prazo + ')' : '');
}

/**
 * Código-fonte das funções que o painel usa no navegador.
 * Assim o cálculo do painel e o gravado na planilha saem da mesma fonte.
 */
function codigoLogicaParaPainel_() {
  return [normalizar_, chaveTitulo_, soDigitos_, mostrarCpf_, numero_, arredondar2_,
    formatarMoeda_, melhoresPorBanco_, simular_, descreverMelhor_]
    .map(function (f) { return f.toString(); })
    .join('\n');
}

// Para os testes em Node. No Apps Script, `module` não existe e isto é ignorado.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STATUS: STATUS, LISTA_STATUS: LISTA_STATUS, STATUS_FINAIS: STATUS_FINAIS, CAMPOS_CLIENTE: CAMPOS_CLIENTE, TITULOS_PADRAO: TITULOS_PADRAO,
    normalizar_: normalizar_, chaveTitulo_: chaveTitulo_, soDigitos_: soDigitos_,
    formatarCpf_: formatarCpf_, mostrarCpf_: mostrarCpf_, numero_: numero_,
    arredondar2_: arredondar2_, formatarMoeda_: formatarMoeda_,
    limparCliente_: limparCliente_, chaveCliente_: chaveCliente_, novaLinhaFila_: novaLinhaFila_,
    mesclarFila_: mesclarFila_, escolherAtual_: escolherAtual_, resumoDaFila_: resumoDaFila_,
    mapearColunas_: mapearColunas_, encontrarLinhaCabecalho_: encontrarLinhaCabecalho_,
    lerCoeficientes_: lerCoeficientes_, melhoresPorBanco_: melhoresPorBanco_,
    simular_: simular_, descreverMelhor_: descreverMelhor_,
    codigoLogicaParaPainel_: codigoLogicaParaPainel_
  };
}
