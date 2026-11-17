// Fluxo completo do Codigo.gs numa planilha simulada (test/mock-sheets.js), com as bases fictícias.
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarProjeto } = require('./mock-sheets');

function fila(planilha) {
  const aba = planilha.getSheetByName('Fila');
  return aba.getDataRange().getValues();
}

test('configuração inicial cria as três abas e não mexe se já existirem', () => {
  const { ctx, planilha, alertas } = carregarProjeto();
  ctx.configuracaoInicial();
  assert.deepEqual(planilha.getSheets().map(a => a.getName()), ['Config', 'Coeficientes', 'Fila']);
  assert.equal(fila(planilha)[0][0], 'Chave');
  assert.deepEqual(planilha.getSheetByName('Fila').ocultas, [1]);
  ctx.configuracaoInicial();
  assert.match(alertas[1], /já existem/);
});

test('fluxo: bases de exemplo → atualizar fila → painel → finalizar → devolver pulados', () => {
  const { ctx, planilha, alertas, travas } = carregarProjeto();
  ctx.configuracaoInicial();
  ctx.criarBasesDeExemplo();

  // Atualizar fila
  ctx.atualizarFila();
  assert.match(alertas.at(-1), /Exemplo Governo: 4 clientes lidos/);
  assert.match(alertas.at(-1), /Exemplo Previdência: 3 clientes lidos/);
  assert.match(alertas.at(-1), /6 clientes novos/);
  let linhas = fila(planilha).slice(1);
  assert.equal(linhas.length, 6);
  const porNome = Object.fromEntries(linhas.map(l => [l[1], l]));
  // Ana: nas duas bases, sem duplicar; telefone veio da Previdência; órgão da primeira base mantido.
  assert.equal(porNome['Ana Teste Ficticia'][4], '(96) 90000-0010');
  assert.equal(porNome['Ana Teste Ficticia'][5], 'SEED');
  // Bruno: CPF que perdeu o zero, gravado como texto.
  assert.equal(porNome['Bruno Exemplo Silva'][2], '01234567890');
  // Carla só tem matrícula; Diego só tem nome.
  assert.equal(porNome['Carla Modelo Souza'][0], 'MAT:100203');
  assert.equal(porNome['Diego Amostra Lima'][0], 'NOME:diego amostra lima|exemplo governo');
  // Matrícula fica como texto mesmo vindo como número da base.
  assert.equal(porNome['Elisa Ficticia Rocha'][3], '200301');
  assert.ok(linhas.every(l => l[7] === 'Pendente'));

  // Painel: pega o primeiro Pendente e marca Em atendimento.
  let r = ctx.obterAtual();
  assert.equal(r.cliente.nome, 'Ana Teste Ficticia');
  assert.equal(fila(planilha)[1][7], 'Em atendimento');
  assert.equal(r.resumo.naFila, 6);
  assert.equal(r.resumo.feitosHoje, 0);
  assert.equal(r.coeficientes.length, 18);
  assert.equal(r.links.lemitti, 'https://lemitti.com');
  // Chamar de novo mantém o mesmo cliente.
  assert.equal(ctx.obterAtual().cliente.chave, r.cliente.chave);
  // Retorno serializável para google.script.run (sem Date).
  assert.doesNotThrow(() => JSON.stringify(r));

  // Fila reordenada depois que o painel abriu: finalizar acha a linha pela chave.
  const abaFila = planilha.getSheetByName('Fila');
  const c1 = abaFila.celulas[1], c2 = abaFila.celulas[2];
  abaFila.celulas[1] = c2; abaFila.celulas[2] = c1;

  r = ctx.finalizar({
    linha: r.cliente.linha, chave: r.cliente.chave, status: 'Consultado',
    margemEmprestimo: 'R$ 300,00', margemCartao: '50', telefone: '(96) 90000-9999', observacao: ' ligar sexta '
  });
  assert.equal(travas.ativa, false);
  const ana = fila(planilha).find(l => l[1] === 'Ana Teste Ficticia');
  assert.equal(ana[7], 'Consultado');
  assert.equal(ana[8], 300);
  assert.equal(ana[9], 50);
  assert.equal(ana[10], 'Banco do Brasil — R$ 12.448,13 (96x)'); // 300 / 0.0241
  assert.equal(ana[11], 'KardBank — R$ 1.400,00');               // 50 × 28
  assert.equal(ana[4], '(96) 90000-9999');
  assert.equal(ana[13], 'ligar sexta');
  assert.equal(Object.prototype.toString.call(ana[12]), '[object Date]');
  // A linha trocada (Bruno) não foi tocada.
  const bruno = fila(planilha).find(l => l[1] === 'Bruno Exemplo Silva');
  assert.equal(bruno[7], 'Em atendimento'); // virou o próximo, mas sem margens gravadas
  assert.equal(bruno[8], '');

  // Próximo cliente já vem na resposta.
  assert.equal(r.cliente.nome, 'Bruno Exemplo Silva');
  assert.equal(r.resumo.feitosHoje, 1);
  assert.equal(r.resumo.naFila, 5);

  // Pular e Sem margem.
  r = ctx.finalizar({ linha: r.cliente.linha, chave: r.cliente.chave, status: 'Pulado', margemEmprestimo: '', margemCartao: '' });
  r = ctx.finalizar({ linha: r.cliente.linha, chave: r.cliente.chave, status: 'Sem margem', margemEmprestimo: '0', margemCartao: '' });
  assert.equal(r.resumo.feitosHoje, 2);
  assert.equal(r.resumo.naFila, 3);

  // Status inválido e chave inexistente não gravam nada.
  assert.throws(() => ctx.finalizar({ linha: 2, chave: r.cliente.chave, status: 'Pendente' }), /Status inválido/);
  assert.throws(() => ctx.finalizar({ linha: 2, chave: 'CPF:00000000000', status: 'Consultado' }), /não encontrado/);
  assert.equal(travas.ativa, false);

  // Atualizar fila de novo não apaga nada.
  const antes = JSON.stringify(fila(planilha));
  ctx.atualizarFila();
  assert.match(alertas.at(-1), /0 clientes novos/);
  assert.equal(JSON.stringify(fila(planilha)), antes);

  // Devolver pulados.
  ctx.devolverPulados();
  assert.match(alertas.at(-1), /1 clientes pulados voltaram/);
  assert.equal(fila(planilha).find(l => l[1] === 'Bruno Exemplo Silva')[7], 'Pendente');

  // Esvaziar a fila: painel mostra "sem cliente".
  for (let i = 0; i < 10 && r.cliente; i++) {
    r = ctx.finalizar({ linha: r.cliente.linha, chave: r.cliente.chave, status: 'Consultado', margemEmprestimo: '100', margemCartao: '' });
  }
  assert.equal(r.cliente, null);
  assert.equal(r.resumo.naFila, 0);
});

test('criar bases de exemplo duas vezes não duplica as linhas na Config', () => {
  const { ctx, planilha } = carregarProjeto();
  ctx.configuracaoInicial();
  ctx.criarBasesDeExemplo();
  ctx.criarBasesDeExemplo();
  const config = planilha.getSheetByName('Config').getDataRange().getValues();
  assert.equal(config.filter(l => String(l[3]).startsWith('Exemplo')).length, 2);
});
