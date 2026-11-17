// Testes da lógica pura (src/Logica.gs). Rodar com: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const L = require('../src/Logica.gs');

test('numero_: formato brasileiro e com ponto decimal', () => {
  assert.equal(L.numero_('R$ 1.234,56'), 1234.56);
  assert.equal(L.numero_('R$1.234,56'), 1234.56);
  assert.equal(L.numero_('1234,56'), 1234.56);
  assert.equal(L.numero_('1234.56'), 1234.56);
  assert.equal(L.numero_('1.234'), 1234);
  assert.equal(L.numero_('1.234.567,89'), 1234567.89);
  assert.equal(L.numero_('1,234.56'), 1234.56);
  assert.equal(L.numero_('  R$ 350 '), 350);
  assert.equal(L.numero_('R$ 350,00'), 350);
  assert.equal(L.numero_('12.5'), 12.5);
  assert.equal(L.numero_(250.75), 250.75);
  assert.equal(L.numero_('-10,5'), -10.5);
});

test('numero_: vazio ou texto vira null', () => {
  assert.equal(L.numero_(''), null);
  assert.equal(L.numero_(null), null);
  assert.equal(L.numero_(undefined), null);
  assert.equal(L.numero_('abc'), null);
  assert.equal(L.numero_('12a'), null);
  assert.equal(L.numero_(NaN), null);
});

test('formatarCpf_: repõe zeros perdidos e tira pontuação', () => {
  assert.equal(L.formatarCpf_(1234567890), '01234567890');
  assert.equal(L.formatarCpf_('1234567890'), '01234567890');
  assert.equal(L.formatarCpf_(98765432), '00098765432');
  assert.equal(L.formatarCpf_('123.456.789-09'), '12345678909');
  assert.equal(L.formatarCpf_(' 012.345.678-90 '), '01234567890');
  assert.equal(L.formatarCpf_(''), '');
  assert.equal(L.formatarCpf_(null), '');
  assert.equal(L.formatarCpf_('000'), '');
  assert.equal(L.mostrarCpf_('01234567890'), '012.345.678-90');
});

test('normalizar_ e chaveTitulo_: maiúsculas, acentos e espaços', () => {
  assert.equal(L.normalizar_('  MATRÍCULA   do  Servidor '), 'matricula do servidor');
  assert.equal(L.normalizar_('Órgão'), 'orgao');
  assert.equal(L.chaveTitulo_('Ativo?'), 'ativo');
  assert.equal(L.chaveTitulo_(' Cálculo '), 'calculo');
});

test('formatarMoeda_', () => {
  assert.equal(L.formatarMoeda_(1234.5), 'R$ 1.234,50');
  assert.equal(L.formatarMoeda_(0.05), 'R$ 0,05');
  assert.equal(L.formatarMoeda_(1234567.891), 'R$ 1.234.567,89');
  assert.equal(L.formatarMoeda_(null), '');
});

test('chaveCliente_: CPF, senão matrícula, senão nome + base', () => {
  assert.equal(L.chaveCliente_({ cpf: 1234567890, matricula: '9', nome: 'X' }, 'A'), 'CPF:01234567890');
  assert.equal(L.chaveCliente_({ cpf: '', matricula: '00.123-4', nome: 'X' }, 'A'), 'MAT:1234');
  assert.equal(L.chaveCliente_({ nome: '  José  da Silva ' }, 'Base Gov'), 'NOME:jose da silva|base gov');
  assert.equal(L.chaveCliente_({ nome: '' }, 'Base'), '');
});

test('mesclarFila_: cliente repetido em outra base não duplica e só completa campos vazios', () => {
  const entradas = [
    { nome: 'Ana', cpf: 11122233344, matricula: '1', telefone: '', orgao: 'SEED', origem: 'Gov' },
    { nome: 'Ana Outra Grafia', cpf: '111.222.333-44', matricula: '1', telefone: '(96) 90000-0010', orgao: 'AMPREV', origem: 'Prev' }
  ];
  const r = L.mesclarFila_([], entradas);
  assert.equal(r.linhas.length, 1);
  assert.equal(r.novos, 1);
  assert.equal(r.completados, 1);
  const ana = r.linhas[0];
  assert.equal(ana.chave, 'CPF:11122233344');
  assert.equal(ana.nome, 'Ana');          // não sobrescreve
  assert.equal(ana.orgao, 'SEED');        // não sobrescreve
  assert.equal(ana.telefone, '(96) 90000-0010'); // completa vazio
  assert.equal(ana.origem, 'Gov');
  assert.equal(ana.status, 'Pendente');
});

test('mesclarFila_: CPF sem zero bate com CPF formatado', () => {
  const r = L.mesclarFila_([], [
    { nome: 'Bruno', cpf: 1234567890, origem: 'A' },
    { nome: 'Bruno', cpf: '012.345.678-90', origem: 'B' }
  ]);
  assert.equal(r.linhas.length, 1);
  assert.equal(r.linhas[0].cpf, '01234567890');
});

test('mesclarFila_: rodar de novo nunca apaga status, margens nem observação', () => {
  const existentes = [{
    chave: 'CPF:11122233344', nome: 'Ana', cpf: '11122233344', matricula: '', telefone: '', orgao: '',
    origem: 'Gov', status: 'Consultado', margemEmprestimo: 300, margemCartao: 50,
    melhorEmprestimo: 'NG — R$ 11.583,01 (96x)', melhorCartao: 'KardBank — R$ 1.400,00',
    atualizadoEm: new Date(2026, 10, 17), observacao: 'retornar sexta', linha: 2
  }];
  const r = L.mesclarFila_(existentes, [
    { nome: 'Ana', cpf: '11122233344', matricula: '77', telefone: '969', orgao: 'SEED', origem: 'Gov' },
    { nome: 'Novo', cpf: '22233344455', origem: 'Gov' }
  ]);
  assert.equal(r.linhas.length, 2);
  const ana = r.linhas[0];
  assert.equal(ana.status, 'Consultado');
  assert.equal(ana.margemEmprestimo, 300);
  assert.equal(ana.margemCartao, 50);
  assert.equal(ana.melhorEmprestimo, 'NG — R$ 11.583,01 (96x)');
  assert.equal(ana.observacao, 'retornar sexta');
  assert.equal(ana.matricula, '77');
  assert.equal(ana.telefone, '969');
  assert.equal(r.linhas[1].status, 'Pendente');
  assert.notEqual(r.linhas[0], existentes[0], 'não altera o array de entrada');
  assert.equal(existentes[0].telefone, '');

  const deNovo = L.mesclarFila_(r.linhas, [{ nome: 'Ana', cpf: '11122233344', origem: 'Gov' }]);
  assert.equal(deNovo.novos, 0);
  assert.equal(deNovo.completados, 0);
  assert.deepEqual(deNovo.linhas, r.linhas);
});

test('mesclarFila_: sem CPF usa matrícula; sem os dois, nome + base; nada identificável é ignorado', () => {
  const r = L.mesclarFila_([], [
    { nome: 'Carla', matricula: '100203', origem: 'Gov' },
    { nome: 'Carla', matricula: '0100203', telefone: '9', origem: 'Prev' },
    { nome: 'Diego', origem: 'Gov' },
    { nome: 'Diego', origem: 'Prev' },
    { nome: '', cpf: '', matricula: '', origem: 'Gov' }
  ]);
  assert.equal(r.linhas.length, 3);
  assert.equal(r.linhas[0].telefone, '9');
  assert.equal(r.ignorados, 1);
});

const COEF_TABELA = [
  ['Banco', 'Produto', 'Prazo', 'Cálculo', 'Fator', 'Ativo?'],
  ['NG', 'Empréstimo', 84, 'Coeficiente', 0.0275, 'SIM'],
  ['NG', 'Empréstimo', 96, 'Coeficiente', 0.0259, 'SIM'],
  ['Santander', 'Empréstimo', 84, 'Coeficiente', 0.0262, 'SIM'],
  ['Santander', 'Empréstimo', 96, 'Coeficiente', '0,0247', 'SIM'],
  ['Industrial', 'Empréstimo', 96, 'Coeficiente', 0.0200, 'NÃO'],
  ['KardBank', 'Cartão', '', 'Multiplicador', 28, 'SIM'],
  ['NIO', 'Cartão', '', 'Multiplicador', 24.5, ''],
  ['', '', '', '', '', ''],
  ['Sem fator', 'Empréstimo', 84, 'Coeficiente', '', 'SIM']
];

test('lerCoeficientes_: lê pelos títulos, ignora linhas vazias, Ativo vazio = SIM', () => {
  const c = L.lerCoeficientes_(COEF_TABELA);
  assert.equal(c.length, 7);
  assert.deepEqual(c[0], { banco: 'NG', produto: 'emprestimo', prazo: '84', calculo: 'coeficiente', fator: 0.0275, ativo: true });
  assert.equal(c[3].fator, 0.0247);
  assert.equal(c[4].ativo, false);
  assert.equal(c[5].produto, 'cartao');
  assert.equal(c[5].calculo, 'multiplicador');
  assert.equal(c[6].ativo, true);
});

test('simular_: vários prazos por banco mostra só o melhor de cada, em ordem decrescente', () => {
  const coef = L.lerCoeficientes_(COEF_TABELA);
  const r = L.simular_(coef, 'R$ 300,00', '50');
  assert.deepEqual(r.emprestimo.map(x => [x.banco, x.prazo, x.valor]), [
    ['Santander', '96', 12145.75], // 300 / 0.0247
    ['NG', '96', 11583.01]         // 300 / 0.0259
  ]);
  // Industrial está inativo e não aparece.
  assert.deepEqual(r.cartao.map(x => [x.banco, x.valor]), [['KardBank', 1400], ['NIO', 1225]]);
  assert.equal(L.descreverMelhor_(r.emprestimo[0]), 'Santander — R$ 12.145,75 (96x)');
  assert.equal(L.descreverMelhor_(r.cartao[0]), 'KardBank — R$ 1.400,00');
  assert.equal(L.descreverMelhor_(undefined), '');
});

test('simular_: margem vazia, zero ou inválida não gera ranking', () => {
  const coef = L.lerCoeficientes_(COEF_TABELA);
  assert.deepEqual(L.simular_(coef, '', null), { emprestimo: [], cartao: [] });
  assert.deepEqual(L.simular_(coef, '0', 'abc'), { emprestimo: [], cartao: [] });
});

test('escolherAtual_: Em atendimento primeiro; senão o primeiro Pendente', () => {
  const linhas = [
    { chave: 'a', status: 'Consultado' },
    { chave: 'b', status: 'Pendente' },
    { chave: 'c', status: 'Em atendimento' }
  ];
  assert.deepEqual(L.escolherAtual_(linhas), { indice: 2, precisaMarcar: false });
  linhas[2].status = 'Pulado';
  assert.deepEqual(L.escolherAtual_(linhas), { indice: 1, precisaMarcar: true });
  linhas[1].status = 'Sem margem';
  assert.deepEqual(L.escolherAtual_(linhas), { indice: -1, precisaMarcar: false });
});

test('resumoDaFila_: na fila e feitos hoje', () => {
  const fmt = d => (d instanceof Date ? d.toISOString().slice(0, 10) : '');
  const hoje = new Date('2026-11-17T15:00:00Z');
  const ontem = new Date('2026-11-16T15:00:00Z');
  const r = L.resumoDaFila_([
    { chave: 'a', status: 'Pendente' },
    { chave: 'b', status: 'Em atendimento' },
    { chave: 'c', status: 'Consultado', atualizadoEm: hoje },
    { chave: 'd', status: 'Sem margem', atualizadoEm: hoje },
    { chave: 'e', status: 'Consultado', atualizadoEm: ontem },
    { chave: 'f', status: 'Pulado', atualizadoEm: hoje },
    { chave: '', status: 'Pendente' }
  ], '2026-11-17', fmt);
  assert.deepEqual(r, { naFila: 2, feitosHoje: 2, puladosHoje: 1 });
});

test('mapearColunas_ e encontrarLinhaCabecalho_: acha títulos mesmo com linha de título antes', () => {
  const valores = [
    ['DADOS FICTÍCIOS'],
    [],
    ['NOME DO SERVIDOR', ' Cpf ', 'Matrícula', 'Celular'],
    ['Ana', '1', '2', '3']
  ];
  const cand = { nome: ['nome do servidor'], cpf: ['CPF'], matricula: ['MATRICULA'], telefone: ['Telefone', 'celular'], orgao: ['Órgão'] };
  assert.equal(L.encontrarLinhaCabecalho_(valores, cand, 10), 2);
  assert.deepEqual(L.mapearColunas_(valores[2], cand), { nome: 0, cpf: 1, matricula: 2, telefone: 3, orgao: -1 });
});

test('codigoLogicaParaPainel_: o código enviado ao navegador roda sozinho e calcula igual', () => {
  const ctx = vm.createContext({});
  vm.runInContext(L.codigoLogicaParaPainel_(), ctx);
  const coef = L.lerCoeficientes_(COEF_TABELA);
  const noNavegador = vm.runInContext('simular_', ctx)(coef, 'R$ 300,00', '50');
  assert.deepEqual(JSON.parse(JSON.stringify(noNavegador)), JSON.parse(JSON.stringify(L.simular_(coef, 'R$ 300,00', '50'))));
  assert.equal(vm.runInContext('mostrarCpf_("01234567890")', ctx), '012.345.678-90');
  assert.equal(vm.runInContext('formatarMoeda_(numero_("1.234,5"))', ctx), 'R$ 1.234,50');
});
