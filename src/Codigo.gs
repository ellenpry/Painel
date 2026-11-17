/**
 * Painel de Atendimento — V1 (Google Sheets + Apps Script).
 *
 * Esta planilha lê as bases de clientes (que nunca são alteradas) e guarda todo o estado
 * nas próprias abas: Config, Coeficientes e Fila. A lógica pura fica em Logica.gs.
 */

var ABA_CONFIG = 'Config';
var ABA_COEF = 'Coeficientes';
var ABA_FILA = 'Fila';

/** Colunas da aba Fila, na ordem: [campo, título]. */
var FILA_COLUNAS = [
  ['chave', 'Chave'],
  ['nome', 'Nome'],
  ['cpf', 'CPF'],
  ['matricula', 'Matrícula'],
  ['telefone', 'Telefone'],
  ['orgao', 'Órgão'],
  ['origem', 'Origem'],
  ['status', 'Status'],
  ['margemEmprestimo', 'Margem empréstimo'],
  ['margemCartao', 'Margem cartão'],
  ['melhorEmprestimo', 'Melhor empréstimo'],
  ['melhorCartao', 'Melhor cartão'],
  ['atualizadoEm', 'Atualizado em'],
  ['observacao', 'Observação']
];

/** Colunas da tabela de bases na aba Config, na ordem. */
var CONFIG_BASES_TITULOS = ['Usar?', 'Nome da base', 'Link da planilha', 'Aba',
  'Coluna nome', 'Coluna CPF', 'Coluna matrícula', 'Coluna telefone', 'Coluna órgão'];

/** Títulos tentados quando a coluna não foi configurada na aba Config. */
var TITULOS_PADRAO = {
  nome: ['Nome', 'Nome completo', 'Nome do cliente', 'Cliente', 'Servidor', 'Nome do servidor'],
  cpf: ['CPF', 'CPF do cliente'],
  matricula: ['Matrícula', 'Matricula', 'Mat'],
  telefone: ['Telefone', 'Celular', 'Fone', 'WhatsApp', 'Contato', 'Telefone 1'],
  orgao: ['Órgão', 'Orgao', 'Secretaria', 'Lotação', 'Instituição']
};

var LOCK_ESPERA_MS = 20000;

function col_(campo) {
  for (var i = 0; i < FILA_COLUNAS.length; i++) if (FILA_COLUNAS[i][0] === campo) return i + 1;
  throw new Error('Coluna desconhecida: ' + campo);
}

// ---------------------------------------------------------------- menu

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Atendimento')
    .addItem('Abrir painel', 'abrirPainel')
    .addItem('Atualizar fila', 'atualizarFila')
    .addItem('Devolver clientes pulados para a fila', 'devolverPulados')
    .addSeparator()
    .addItem('Configuração inicial', 'configuracaoInicial')
    .addItem('Criar bases de exemplo (dados fictícios)', 'criarBasesDeExemplo')
    .addToUi();
}

function abrirPainel() {
  var html = HtmlService.createTemplateFromFile('Painel').evaluate()
    .setTitle('Atendimento')
    .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ---------------------------------------------------------------- configuração inicial

function configuracaoInicial() {
  var criadas = garantirAbas_(SpreadsheetApp.getActive());
  SpreadsheetApp.getUi().alert(criadas.length
    ? 'Abas criadas: ' + criadas.join(', ') + '.\n\nPróximo passo: preencha a aba Config (links e bases) e troque os coeficientes fictícios da aba Coeficientes.'
    : 'As abas Config, Coeficientes e Fila já existem. Nada foi alterado.');
}

/** Cria as abas que faltarem. Nunca mexe em aba existente. Devolve os nomes criados. */
function garantirAbas_(ss) {
  var criadas = [];
  if (!ss.getSheetByName(ABA_CONFIG)) { criarAbaConfig_(ss); criadas.push(ABA_CONFIG); }
  if (!ss.getSheetByName(ABA_COEF)) { criarAbaCoeficientes_(ss); criadas.push(ABA_COEF); }
  if (!ss.getSheetByName(ABA_FILA)) { criarAbaFila_(ss); criadas.push(ABA_FILA); }
  return criadas;
}

function criarAbaConfig_(ss) {
  var aba = ss.insertSheet(ABA_CONFIG);
  aba.getRange('A1').setValue('Painel de Atendimento — Configuração').setFontWeight('bold').setFontSize(12);
  aba.getRange('A2:C3').setValues([
    ['Site de margem', '', '← cole aqui o link do site de consulta de margem'],
    ['Lemitti', 'https://lemitti.com', '']
  ]);
  aba.getRange('A2:A3').setFontWeight('bold');
  aba.getRange('C2:C3').setFontColor('#80868b');

  aba.getRange('A5').setValue('Bases de clientes — são só lidas, nunca alteradas. Link vazio = aba desta mesma planilha. Título de coluna vazio = tenta os nomes mais comuns.')
    .setFontColor('#5f6368');
  aba.getRange(6, 1, 1, CONFIG_BASES_TITULOS.length).setValues([CONFIG_BASES_TITULOS])
    .setFontWeight('bold').setBackground('#e8f0fe');
  aba.getRange(7, 1, 3, CONFIG_BASES_TITULOS.length).setValues([
    ['NÃO', 'Base 1', '', '', 'Nome', 'CPF', 'Matrícula', 'Telefone', 'Órgão'],
    ['NÃO', 'Base 2', '', '', 'Nome', 'CPF', 'Matrícula', 'Telefone', 'Órgão'],
    ['NÃO', 'Base 3', '', '', 'Nome', 'CPF', 'Matrícula', 'Telefone', 'Órgão']
  ]);
  aba.getRange('A7:A30').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['SIM', 'NÃO'], true).build());
  aba.setColumnWidth(1, 120);
  aba.setColumnWidth(2, 160);
  aba.setColumnWidth(3, 320);
  aba.setFrozenRows(0);
  return aba;
}

function criarAbaCoeficientes_(ss) {
  var aba = ss.insertSheet(ABA_COEF);
  var titulos = ['Banco', 'Produto', 'Prazo', 'Cálculo', 'Fator', 'Ativo?'];
  // VALORES FICTÍCIOS: servem só para testar o painel. Trocar pelos coeficientes reais.
  var bancos = [
    ['Santander', 0.0262, 0.0247, 26.5],
    ['Banco do Brasil', 0.0255, 0.0241, 27.0],
    ['Industrial', 0.0270, 0.0255, 25.0],
    ['NIO', 0.0268, 0.0250, 24.5],
    ['NG', 0.0275, 0.0259, 25.5],
    ['KardBank', 0.0280, 0.0262, 28.0]
  ];
  var linhas = [];
  bancos.forEach(function (b) {
    linhas.push([b[0], 'Empréstimo', 84, 'Coeficiente', b[1], 'SIM']);
    linhas.push([b[0], 'Empréstimo', 96, 'Coeficiente', b[2], 'SIM']);
    linhas.push([b[0], 'Cartão', '', 'Multiplicador', b[3], 'SIM']);
  });
  aba.getRange(1, 1, 1, titulos.length).setValues([titulos]).setFontWeight('bold').setBackground('#e8f0fe');
  aba.getRange(2, 1, linhas.length, titulos.length).setValues(linhas);
  aba.getRange(2, 5, linhas.length, 1).setNumberFormat('0.0000');
  aba.getRange('H1').setValue('⚠ VALORES FICTÍCIOS — substitua pelos coeficientes reais de cada banco.')
    .setFontWeight('bold').setFontColor('#c5221f');
  aba.getRange('H2').setValue('Coeficiente: liberado = margem ÷ fator. Multiplicador: liberado = margem × fator.')
    .setFontColor('#5f6368');
  aba.getRange('B2:B200').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Empréstimo', 'Cartão'], true).build());
  aba.getRange('D2:D200').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Coeficiente', 'Multiplicador'], true).build());
  aba.getRange('F2:F200').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['SIM', 'NÃO'], true).build());
  aba.setFrozenRows(1);
  aba.setColumnWidth(1, 140);
  return aba;
}

function criarAbaFila_(ss) {
  var aba = ss.insertSheet(ABA_FILA);
  var titulos = FILA_COLUNAS.map(function (c) { return c[1]; });
  aba.getRange(1, 1, 1, titulos.length).setValues([titulos]).setFontWeight('bold').setBackground('#e8f0fe');
  aba.setFrozenRows(1);
  formatarColunasFila_(aba, 2, Math.max(aba.getMaxRows() - 1, 1));
  aba.hideColumns(col_('chave'));
  aba.setColumnWidth(col_('nome'), 220);
  aba.setColumnWidth(col_('melhorEmprestimo'), 220);
  aba.setColumnWidth(col_('melhorCartao'), 220);
  return aba;
}

/** Formatos que precisam valer também para linhas novas: texto, moeda, data e validação de status. */
function formatarColunasFila_(aba, primeiraLinha, qtd) {
  if (qtd < 1) return;
  ['cpf', 'matricula', 'telefone'].forEach(function (c) {
    aba.getRange(primeiraLinha, col_(c), qtd, 1).setNumberFormat('@');
  });
  aba.getRange(primeiraLinha, col_('margemEmprestimo'), qtd, 2).setNumberFormat('"R$" #,##0.00');
  aba.getRange(primeiraLinha, col_('atualizadoEm'), qtd, 1).setNumberFormat('dd/MM/yyyy HH:mm');
  aba.getRange(primeiraLinha, col_('status'), qtd, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(LISTA_STATUS, true).setAllowInvalid(false).build());
}

// ---------------------------------------------------------------- leitura da Config

/** {siteMargem, lemitti, bases: [{usar, nome, link, aba, colunas: {nome, cpf, ...}}]} */
function lerConfig_(ss) {
  var aba = ss.getSheetByName(ABA_CONFIG);
  if (!aba) throw new Error('Aba Config não encontrada. Use Atendimento › Configuração inicial.');
  var valores = aba.getDataRange().getDisplayValues();
  var config = { siteMargem: '', lemitti: '', bases: [] };
  var linhaTitulos = -1;
  for (var i = 0; i < valores.length; i++) {
    var rotulo = chaveTitulo_(valores[i][0]);
    if (rotulo === 'site de margem') config.siteMargem = String(valores[i][1] || '').trim();
    else if (rotulo === 'lemitti') config.lemitti = String(valores[i][1] || '').trim();
    else if (rotulo === 'usar' && linhaTitulos < 0) linhaTitulos = i;
  }
  if (linhaTitulos < 0) return config;
  for (var j = linhaTitulos + 1; j < valores.length; j++) {
    var v = valores[j];
    var nome = String(v[1] || '').trim();
    var link = String(v[2] || '').trim();
    var abaNome = String(v[3] || '').trim();
    if (!nome && !link && !abaNome) continue;
    config.bases.push({
      usar: ['sim', 's', 'x', 'true'].indexOf(chaveTitulo_(v[0])) >= 0,
      nome: nome || ('Base ' + (config.bases.length + 1)),
      link: link,
      aba: abaNome,
      colunas: {
        nome: String(v[4] || '').trim(),
        cpf: String(v[5] || '').trim(),
        matricula: String(v[6] || '').trim(),
        telefone: String(v[7] || '').trim(),
        orgao: String(v[8] || '').trim()
      }
    });
  }
  return config;
}

function abrirPlanilha_(link) {
  if (/^https?:\/\//i.test(link)) return SpreadsheetApp.openByUrl(link);
  return SpreadsheetApp.openById(link);
}

/** Lê uma base e devolve {clientes, avisos}. Lança erro se a base não puder ser lida. */
function lerBase_(ss, base) {
  var arquivo = base.link ? abrirPlanilha_(base.link) : ss;
  var aba = base.aba ? arquivo.getSheetByName(base.aba) : arquivo.getSheets()[0];
  if (!aba) throw new Error('aba "' + base.aba + '" não encontrada');
  var valores = aba.getDataRange().getValues();
  if (!valores.length) return { clientes: [], avisos: ['base vazia'] };

  var candidatos = {};
  CAMPOS_CLIENTE.forEach(function (campo) {
    candidatos[campo] = base.colunas[campo] ? [base.colunas[campo]] : TITULOS_PADRAO[campo];
  });
  var linhaTitulos = encontrarLinhaCabecalho_(valores, candidatos, 10);
  if (linhaTitulos < 0) throw new Error('não achei a linha de títulos (confira os títulos de coluna na aba Config)');
  var mapa = mapearColunas_(valores[linhaTitulos], candidatos);

  var avisos = [];
  if (mapa.nome < 0) throw new Error('coluna de nome "' + (base.colunas.nome || 'Nome') + '" não encontrada');
  CAMPOS_CLIENTE.forEach(function (campo) {
    if (mapa[campo] < 0 && base.colunas[campo]) avisos.push('coluna "' + base.colunas[campo] + '" não encontrada');
  });
  if (mapa.cpf < 0 && mapa.matricula < 0) avisos.push('sem coluna de CPF nem de matrícula: a chave será nome + base');

  var clientes = [];
  for (var i = linhaTitulos + 1; i < valores.length; i++) {
    var v = valores[i];
    var c = { origem: base.nome };
    CAMPOS_CLIENTE.forEach(function (campo) { c[campo] = mapa[campo] >= 0 ? v[mapa[campo]] : ''; });
    if (String(c.nome).trim() || String(c.cpf).trim() || String(c.matricula).trim()) clientes.push(c);
  }
  return { clientes: clientes, avisos: avisos };
}

// ---------------------------------------------------------------- Fila

function linhaParaObjeto_(valores, numeroLinha) {
  var o = { linha: numeroLinha };
  FILA_COLUNAS.forEach(function (c, i) { o[c[0]] = valores[i]; });
  o.chave = String(o.chave == null ? '' : o.chave);
  o.status = String(o.status == null ? '' : o.status);
  return o;
}

function objetoParaLinha_(o) {
  return FILA_COLUNAS.map(function (c) {
    var v = o[c[0]];
    return v == null ? '' : v;
  });
}

function lerFila_(aba) {
  var ultima = aba.getLastRow();
  if (ultima < 2) return [];
  var valores = aba.getRange(2, 1, ultima - 1, FILA_COLUNAS.length).getValues();
  return valores.map(function (v, i) { return linhaParaObjeto_(v, i + 2); });
}

function atualizarFila() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  garantirAbas_(ss);
  var config = lerConfig_(ss);
  var bases = config.bases.filter(function (b) { return b.usar; });
  if (!bases.length) {
    ui.alert('Nenhuma base marcada com SIM na aba Config.');
    return;
  }

  // Lê as bases fora do lock: pode demorar e não mexe na Fila.
  var entradas = [];
  var relatorio = [];
  bases.forEach(function (base) {
    try {
      var r = lerBase_(ss, base);
      entradas = entradas.concat(r.clientes);
      relatorio.push('• ' + base.nome + ': ' + r.clientes.length + ' clientes lidos' +
        (r.avisos.length ? ' (' + r.avisos.join('; ') + ')' : ''));
    } catch (e) {
      relatorio.push('• ' + base.nome + ': ERRO — ' + e.message);
    }
  });

  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  var resultado;
  try {
    var aba = ss.getSheetByName(ABA_FILA);
    var existentes = lerFila_(aba);
    resultado = mesclarFila_(existentes, entradas);
    gravarFilaInteira_(aba, resultado.linhas, existentes.length);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  ui.alert('Fila atualizada',
    relatorio.join('\n') + '\n\n' +
    resultado.novos + ' clientes novos na fila\n' +
    resultado.completados + ' clientes já existentes ganharam dados que faltavam\n' +
    (resultado.ignorados ? resultado.ignorados + ' linhas sem nome, CPF ou matrícula foram ignoradas\n' : '') +
    '\nStatus, margens e observações já gravados não foram alterados.',
    ui.ButtonSet.OK);
}

/**
 * Regrava a Fila. Como mesclarFila_ nunca remove linhas nem muda campos de atendimento,
 * as linhas existentes voltam com os mesmos valores (só cadastro vazio é preenchido).
 */
function gravarFilaInteira_(aba, linhas, qtdAntes) {
  if (!linhas.length) return;
  if (linhas.length > qtdAntes) {
    formatarColunasFila_(aba, 2 + qtdAntes, linhas.length - qtdAntes);
  }
  aba.getRange(2, 1, linhas.length, FILA_COLUNAS.length).setValues(linhas.map(objetoParaLinha_));
}

function devolverPulados() {
  var ss = SpreadsheetApp.getActive();
  var aba = ss.getSheetByName(ABA_FILA);
  if (!aba) { SpreadsheetApp.getUi().alert('Aba Fila não encontrada. Use Atendimento › Configuração inicial.'); return; }
  var lock = LockService.getDocumentLock();
  lock.waitLock(LOCK_ESPERA_MS);
  var qtd = 0;
  try {
    var ultima = aba.getLastRow();
    if (ultima >= 2) {
      var faixa = aba.getRange(2, col_('status'), ultima - 1, 1);
      var valores = faixa.getValues();
      valores.forEach(function (v) {
        if (v[0] === STATUS.PULADO) { v[0] = STATUS.PENDENTE; qtd++; }
      });
      if (qtd) faixa.setValues(valores);
    }
  } finally {
    lock.releaseLock();
  }
  SpreadsheetApp.getUi().alert(qtd ? qtd + ' clientes pulados voltaram para a fila.' : 'Não há clientes pulados.');
}

// ---------------------------------------------------------------- painel (chamado via google.script.run)

/** Cliente atual + links + coeficientes + números do topo. */
function obterAtual() {
  var lock = LockService.getDocumentLock();
  lock.waitLock(LOCK_ESPERA_MS);
  try {
    return obterAtualSemLock_(SpreadsheetApp.getActive());
  } finally {
    lock.releaseLock();
  }
}

function obterAtualSemLock_(ss) {
  var aba = ss.getSheetByName(ABA_FILA);
  if (!aba) throw new Error('Aba Fila não encontrada. Use Atendimento › Configuração inicial.');
  var linhas = lerFila_(aba);
  var escolha = escolherAtual_(linhas);
  var atual = escolha.indice >= 0 ? linhas[escolha.indice] : null;
  if (atual && escolha.precisaMarcar) {
    aba.getRange(atual.linha, col_('status')).setValue(STATUS.EM_ATENDIMENTO);
    atual.status = STATUS.EM_ATENDIMENTO;
  }

  var tz = ss.getSpreadsheetTimeZone();
  var hoje = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var resumo = resumoDaFila_(linhas, hoje, function (d) {
    return d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : '';
  });

  var config = lerConfig_(ss);
  var abaCoef = ss.getSheetByName(ABA_COEF);
  var coeficientes = abaCoef ? lerCoeficientes_(abaCoef.getDataRange().getValues()) : [];

  // google.script.run só aceita primitivos, objetos e arrays (nada de Date).
  return {
    cliente: atual ? {
      linha: atual.linha,
      chave: atual.chave,
      nome: String(atual.nome || ''),
      cpf: String(atual.cpf || ''),
      matricula: String(atual.matricula || ''),
      telefone: String(atual.telefone || ''),
      orgao: String(atual.orgao || ''),
      origem: String(atual.origem || ''),
      observacao: String(atual.observacao || ''),
      margemEmprestimo: typeof atual.margemEmprestimo === 'number' ? atual.margemEmprestimo : null,
      margemCartao: typeof atual.margemCartao === 'number' ? atual.margemCartao : null
    } : null,
    links: { margem: config.siteMargem, lemitti: config.lemitti },
    coeficientes: coeficientes,
    resumo: resumo
  };
}

/**
 * Grava o atendimento e devolve o próximo cliente (mesmo formato de obterAtual).
 * @param {{linha, chave, status, margemEmprestimo, margemCartao, telefone, observacao}} dados
 */
function finalizar(dados) {
  if (!dados || STATUS_FINAIS.indexOf(dados.status) < 0) throw new Error('Status inválido: ' + (dados && dados.status));
  var ss = SpreadsheetApp.getActive();
  var lock = LockService.getDocumentLock();
  lock.waitLock(LOCK_ESPERA_MS);
  try {
    var aba = ss.getSheetByName(ABA_FILA);
    if (!aba) throw new Error('Aba Fila não encontrada.');

    // Confere a chave antes de escrever: a fila pode ter sido reordenada desde que o cliente abriu.
    var linha = Number(dados.linha);
    var chaveNaLinha = linha >= 2 && linha <= aba.getLastRow() ? String(aba.getRange(linha, col_('chave')).getValue()) : '';
    if (!dados.chave || chaveNaLinha !== String(dados.chave)) {
      var achada = lerFila_(aba).filter(function (l) { return l.chave === String(dados.chave); })[0];
      if (!achada) throw new Error('Cliente não encontrado na Fila (a linha foi apagada?). Nada foi gravado.');
      linha = achada.linha;
    }

    var abaCoef = ss.getSheetByName(ABA_COEF);
    var coeficientes = abaCoef ? lerCoeficientes_(abaCoef.getDataRange().getValues()) : [];
    var margemEmp = numero_(dados.margemEmprestimo);
    var margemCartao = numero_(dados.margemCartao);
    var sim = simular_(coeficientes, margemEmp, margemCartao);

    if (dados.telefone != null) {
      aba.getRange(linha, col_('telefone')).setNumberFormat('@').setValue(String(dados.telefone).trim());
    }
    // Status … Observação são colunas contíguas.
    aba.getRange(linha, col_('status'), 1, col_('observacao') - col_('status') + 1).setValues([[
      dados.status,
      margemEmp == null ? '' : margemEmp,
      margemCartao == null ? '' : margemCartao,
      descreverMelhor_(sim.emprestimo[0]),
      descreverMelhor_(sim.cartao[0]),
      new Date(),
      String(dados.observacao == null ? '' : dados.observacao).trim()
    ]]);
    SpreadsheetApp.flush();

    return obterAtualSemLock_(ss);
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- dados de exemplo

/**
 * Cria duas abas com clientes FICTÍCIOS nesta planilha e as liga na Config,
 * para testar Atualizar fila e o painel sem usar dados reais.
 * Cobre: títulos diferentes entre bases, CPF que perdeu o zero, cliente repetido
 * entre bases (telefone só numa delas), cliente só com matrícula e cliente só com nome.
 */
function criarBasesDeExemplo() {
  var ss = SpreadsheetApp.getActive();
  garantirAbas_(ss);
  var bases = [
    {
      aba: 'Exemplo - Governo', nome: 'Exemplo Governo',
      colunas: ['NOME DO SERVIDOR', 'Cpf', 'Matrícula', 'Celular', 'Secretaria'],
      linhas: [
        ['Ana Teste Ficticia', '11122233344', '100201', '', 'SEED'],
        ['Bruno Exemplo Silva', 1234567890, '100202', '(96) 90000-0001', 'SESA'],
        ['Carla Modelo Souza', '', '100203', '(96) 90000-0002', 'SEFAZ'],
        ['Diego Amostra Lima', '', '', '(96) 90000-0003', 'PM-AP']
      ]
    },
    {
      aba: 'Exemplo - Previdência', nome: 'Exemplo Previdência',
      colunas: ['Nome', 'CPF', 'MATRICULA', 'Telefone', 'Órgão'],
      linhas: [
        ['Ana Teste Ficticia', '111.222.333-44', '100201', '(96) 90000-0010', 'AMPREV'],
        ['Elisa Ficticia Rocha', '55566677788', '200301', '(96) 90000-0011', 'AMPREV'],
        ['Fabio Teste Nunes', '99988877766', '200302', '', 'AMPREV']
      ]
    }
  ];

  bases.forEach(function (b) {
    var aba = ss.getSheetByName(b.aba) || ss.insertSheet(b.aba);
    aba.clear();
    aba.getRange('A1').setValue('DADOS FICTÍCIOS PARA TESTE').setFontWeight('bold').setFontColor('#c5221f');
    aba.getRange(3, 1, 1, b.colunas.length).setValues([b.colunas]).setFontWeight('bold');
    aba.getRange(4, 1, b.linhas.length, b.colunas.length).setValues(b.linhas);
  });

  var config = ss.getSheetByName(ABA_CONFIG);
  var jaLigadas = lerConfig_(ss).bases.map(function (b) { return b.aba; });
  var novas = bases.filter(function (b) { return jaLigadas.indexOf(b.aba) < 0; }).map(function (b) {
    return ['SIM', b.nome, '', b.aba].concat(b.colunas);
  });
  if (novas.length) {
    config.getRange(config.getLastRow() + 1, 1, novas.length, CONFIG_BASES_TITULOS.length).setValues(novas);
  }

  SpreadsheetApp.getUi().alert('Bases de exemplo criadas e ligadas na aba Config.\n\n' +
    'Agora use Atendimento › Atualizar fila e depois Abrir painel.\n' +
    'Esperado: 7 linhas lidas, 6 clientes na fila (Ana aparece nas duas bases e não duplica; ' +
    'o telefone dela vem da base Previdência; o CPF do Bruno ganha o zero da frente).');
}
