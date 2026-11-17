// Testes da API contra um PostgreSQL de verdade.
// Precisa de um banco descartável em TEST_DATABASE_URL (o esquema "public" é APAGADO).
//   docker run -d --name painel-teste-db -e POSTGRES_PASSWORD=teste -p 127.0.0.1:5433:5432 postgres:16-alpine
//   TEST_DATABASE_URL=postgres://postgres:teste@localhost:5433/postgres npm test
const test = require('node:test');
const assert = require('node:assert/strict');

const URL_TESTE = process.env.TEST_DATABASE_URL;
if (!URL_TESTE) {
  test('API (pulado: defina TEST_DATABASE_URL)', { skip: true }, () => {});
  return;
}
process.env.DATABASE_URL = URL_TESTE;
process.env.EMAIL_MODO = 'memoria';
process.env.ADMIN_EMAIL = 'admin@teste.local';
process.env.ADMIN_SENHA = 'senha-admin-123';
process.env.ADMIN_NOME = 'Admin Teste';
process.env.TRUST_PROXY = 'false';

const db = require('../server/db');
const { migrar } = require('../server/migrar');
const { semear } = require('../server/seed');
const { criarApp } = require('../server/app');
const email = require('../server/email');

let servidor, base;

/** Cliente HTTP com cookies, como um navegador. */
function navegador() {
  let cookie = '';
  async function req(metodo, caminho, corpo, { semCabecalho = false } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (!semCabecalho) headers['x-requested-with'] = 'painel';
    if (cookie) headers.cookie = cookie;
    const r = await fetch(base + caminho, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined, redirect: 'manual' });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    let json = null;
    if ((r.headers.get('content-type') || '').includes('json')) json = await r.json();
    return { status: r.status, json, headers: r.headers };
  }
  return {
    get: c => req('GET', c), post: (c, b, o) => req('POST', c, b || {}, o), put: (c, b) => req('PUT', c, b),
    patch: (c, b) => req('PATCH', c, b), del: c => req('DELETE', c),
    get cookie() { return cookie; }
  };
}

function tokenDoUltimoEmail(para) {
  const msg = [...email.enviados].reverse().find(m => m.to === para);
  assert.ok(msg, 'e-mail não enviado para ' + para);
  return /token=([A-Za-z0-9_-]+)/.exec(msg.text)[1];
}

test.before(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrar();
  await semear({ log: () => {} });
  servidor = criarApp().listen(0);
  await new Promise(r => servidor.once('listening', r));
  base = 'http://127.0.0.1:' + servidor.address().port;
});

test.after(async () => {
  servidor.close();
  await db.pool.end();
});

const CSV_GOVERNO = 'DADOS FICTÍCIOS\n\nNOME DO SERVIDOR;Cpf;Matrícula;Celular;Secretaria\n' +
  'Ana Teste Ficticia;11122233344;100201;;SEED\n' +
  'Bruno Exemplo Silva;1234567890;100202;(96) 90000-0001;SESA\n' +
  'Carla Modelo Souza;;100203;(96) 90000-0002;SEFAZ\n' +
  '"Diego ""Amostra"" Lima";;;(96) 90000-0003;PM-AP\n';
const CSV_PREV = 'Nome,CPF,MATRICULA,Telefone,Órgão\n' +
  'Ana Teste Ficticia,111.222.333-44,100201,(96) 90000-0010,AMPREV\n' +
  'Elisa Ficticia Rocha,55566677788,200301,(96) 90000-0011,AMPREV\n';

test('páginas: sem sessão vai para o login; não existe cadastro aberto', async () => {
  const b = navegador();
  assert.equal((await b.get('/')).headers.get('location'), '/login');
  assert.equal((await b.get('/app')).headers.get('location'), '/login');
  assert.equal((await b.get('/login')).status, 200);
  assert.equal((await b.get('/api/atendimento/atual')).status, 401);
  const cadastro = await b.post('/api/auth/cadastro', { email: 'x@x.com', senha: '12345678' });
  assert.ok([401, 404].includes(cadastro.status), 'não existe cadastro aberto');
  const js = await fetch(base + '/js/logica.js');
  assert.match(await js.text(), /function simular_/);
});

test('login: senha errada, CSRF, sucesso, logout', async () => {
  const b = navegador();
  let r = await b.post('/api/auth/login', { email: 'admin@teste.local', senha: 'errada' });
  assert.equal(r.status, 401);
  assert.equal(r.json.erro, 'E-mail ou senha incorretos.');
  r = await b.post('/api/auth/login', { email: 'ninguem@teste.local', senha: 'x' });
  assert.equal(r.json.erro, 'E-mail ou senha incorretos.', 'mesma mensagem para e-mail inexistente');
  r = await b.post('/api/auth/login', { email: 'admin@teste.local', senha: 'senha-admin-123' }, { semCabecalho: true });
  assert.equal(r.status, 403, 'sem X-Requested-With é recusado');
  r = await b.post('/api/auth/login', { email: ' ADMIN@teste.local ', senha: 'senha-admin-123' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/i);
  assert.equal((await b.get('/api/auth/eu')).json.usuario.papel, 'admin');
  await b.post('/api/auth/logout');
  assert.equal((await b.get('/api/auth/eu')).status, 401);
});

test('login: bloqueia depois de muitas tentativas erradas', async () => {
  const b = navegador();
  for (let i = 0; i < 10; i++) await b.post('/api/auth/login', { email: 'bloqueio@teste.local', senha: 'x' });
  const r = await b.post('/api/auth/login', { email: 'bloqueio@teste.local', senha: 'x' });
  assert.equal(r.status, 429);
});

test('convite: admin convida, pessoa aceita, papel respeitado, link de uso único', async () => {
  const admin = navegador();
  await admin.post('/api/auth/login', { email: 'admin@teste.local', senha: 'senha-admin-123' });
  let r = await admin.post('/api/convites', { email: 'Aline@Teste.local', papel: 'atendente' });
  assert.equal(r.status, 200);
  assert.equal(r.json.emailEnviado, true);
  assert.match(r.json.link, /\/convite\?token=/);
  const token = tokenDoUltimoEmail('aline@teste.local');

  assert.equal((await admin.post('/api/convites', { email: 'admin@teste.local' })).status, 409);
  assert.equal((await admin.get('/api/usuarios')).json.convites.length, 1);

  const aline = navegador();
  r = await aline.get('/api/auth/convites/' + token);
  assert.deepEqual(r.json, { email: 'aline@teste.local', papel: 'atendente' });
  r = await aline.post('/api/auth/convites/aceitar', { token, nome: 'Aline', senha: 'curta' });
  assert.equal(r.status, 400);
  r = await aline.post('/api/auth/convites/aceitar', { token, nome: 'Aline', senha: 'senha-aline-123' });
  assert.equal(r.status, 200);
  assert.equal((await aline.get('/api/auth/eu')).json.usuario.nome, 'Aline');
  // Atendente não acessa telas de administração.
  assert.equal((await aline.get('/api/usuarios')).status, 403);
  assert.equal((await aline.post('/api/convites', { email: 'z@z.com' })).status, 403);
  assert.equal((await aline.put('/api/coeficientes', { coeficientes: [] })).status, 403);
  // Convite não pode ser reutilizado.
  const outro = navegador();
  r = await outro.post('/api/auth/convites/aceitar', { token, nome: 'Intrusa', senha: 'senha-qualquer' });
  assert.equal(r.status, 404);
  assert.equal((await outro.get('/api/auth/convites/token-inventado')).status, 404);
});

test('convite novo para o mesmo e-mail cancela o anterior; cancelar convite', async () => {
  const admin = navegador();
  await admin.post('/api/auth/login', { email: 'admin@teste.local', senha: 'senha-admin-123' });
  await admin.post('/api/convites', { email: 'bia@teste.local' });
  const primeiro = tokenDoUltimoEmail('bia@teste.local');
  await admin.post('/api/convites', { email: 'bia@teste.local' });
  const segundo = tokenDoUltimoEmail('bia@teste.local');
  assert.equal((await admin.get('/api/auth/convites/' + primeiro)).status, 404);
  assert.equal((await admin.get('/api/auth/convites/' + segundo)).status, 200);
  const conv = (await admin.get('/api/usuarios')).json.convites.find(c => c.email === 'bia@teste.local');
  await admin.del('/api/convites/' + conv.id);
  assert.equal((await admin.get('/api/auth/convites/' + segundo)).status, 404);
});

test('recuperação de senha: link por e-mail, uso único, derruba sessões antigas', async () => {
  const antiga = navegador();
  await antiga.post('/api/auth/login', { email: 'aline@teste.local', senha: 'senha-aline-123' });
  assert.equal((await antiga.get('/api/auth/eu')).status, 200);

  const b = navegador();
  let r = await b.post('/api/auth/esqueci-senha', { email: 'aline@teste.local' });
  assert.equal(r.status, 200);
  const r2 = await b.post('/api/auth/esqueci-senha', { email: 'naoexiste@teste.local' });
  assert.equal(r2.json.mensagem, r.json.mensagem, 'não revela se o e-mail existe');
  const token = tokenDoUltimoEmail('aline@teste.local');

  assert.equal((await b.get('/api/auth/redefinir-senha/' + token)).json.email, 'aline@teste.local');
  r = await b.post('/api/auth/redefinir-senha', { token, senha: 'nova-senha-aline' });
  assert.equal(r.status, 200);
  assert.equal((await b.get('/api/auth/eu')).json.usuario.email, 'aline@teste.local', 'já entra logada');
  assert.equal((await antiga.get('/api/auth/eu')).status, 401, 'sessão antiga caiu');
  assert.equal((await b.post('/api/auth/redefinir-senha', { token, senha: 'outra-senha-123' })).status, 404, 'link de uso único');
  assert.equal((await navegador().post('/api/auth/login', { email: 'aline@teste.local', senha: 'senha-aline-123' })).status, 401);
  assert.equal((await navegador().post('/api/auth/login', { email: 'aline@teste.local', senha: 'nova-senha-aline' })).status, 200);
});

test('recuperação: pedido novo invalida o link anterior; link vencido não serve', async () => {
  const b = navegador();
  await b.post('/api/auth/esqueci-senha', { email: 'admin@teste.local' });
  const t1 = tokenDoUltimoEmail('admin@teste.local');
  await b.post('/api/auth/esqueci-senha', { email: 'admin@teste.local' });
  const t2 = tokenDoUltimoEmail('admin@teste.local');
  assert.equal((await b.get('/api/auth/redefinir-senha/' + t1)).status, 404);
  await db.query("UPDATE redefinicoes_senha SET expira_em = now() - interval '1 minute' WHERE usado_em IS NULL");
  assert.equal((await b.get('/api/auth/redefinir-senha/' + t2)).status, 404);
});

test('trocar senha logado', async () => {
  const b = navegador();
  await b.post('/api/auth/login', { email: 'aline@teste.local', senha: 'nova-senha-aline' });
  assert.equal((await b.post('/api/auth/trocar-senha', { senhaAtual: 'errada', novaSenha: 'senha-nova-2' })).status, 400);
  assert.equal((await b.post('/api/auth/trocar-senha', { senhaAtual: 'nova-senha-aline', novaSenha: 'senha-nova-2' })).status, 200);
  assert.equal((await b.get('/api/auth/eu')).status, 200);
  assert.equal((await navegador().post('/api/auth/login', { email: 'aline@teste.local', senha: 'senha-nova-2' })).status, 200);
});

test('importação: prévia, deduplicação entre bases e reimportação sem perder nada', async () => {
  const b = navegador();
  await b.post('/api/auth/login', { email: 'aline@teste.local', senha: 'senha-nova-2' });

  let r = await b.post('/api/importacoes/previa', { base: 'Governo', csv: CSV_GOVERNO });
  assert.equal(r.status, 200);
  assert.equal(r.json.linhas, 4);
  assert.equal(r.json.colunasAchadas.nome, 'NOME DO SERVIDOR');
  assert.equal(r.json.colunasAchadas.telefone, 'Celular');
  assert.equal(r.json.colunasAchadas.orgao, 'Secretaria');

  assert.equal((await b.post('/api/importacoes', { base: '', csv: CSV_GOVERNO })).status, 400);
  assert.equal((await b.post('/api/importacoes', { base: 'X', csv: 'a;b\n1;2' })).status, 400);

  r = await b.post('/api/importacoes', { base: 'Governo', csv: CSV_GOVERNO, arquivo: 'governo.csv' });
  assert.deepEqual([r.json.novos, r.json.completados], [4, 0]);
  r = await b.post('/api/importacoes', { base: 'Previdência', csv: CSV_PREV });
  assert.deepEqual([r.json.novos, r.json.completados], [1, 1]);

  r = await b.get('/api/clientes');
  assert.equal(r.json.total, 5);
  const ana = r.json.clientes.find(c => c.nome === 'Ana Teste Ficticia');
  assert.equal(ana.telefone, '(96) 90000-0010');
  assert.equal(ana.orgao, 'SEED');
  assert.equal(r.json.clientes.find(c => c.nome.startsWith('Bruno')).cpf, '01234567890');
  assert.ok(r.json.clientes.find(c => c.nome === 'Diego "Amostra" Lima'));

  assert.equal((await b.get('/api/clientes?busca=012.345')).json.total, 1);
  assert.equal((await b.get('/api/clientes?busca=amprev')).json.total, 1);
  assert.equal((await b.get('/api/importacoes')).json.importacoes.length, 2);
});

test('atendimento: um cliente por vez, cálculo no servidor, sem conflito entre usuárias', async () => {
  const aline = navegador();
  await aline.post('/api/auth/login', { email: 'aline@teste.local', senha: 'senha-nova-2' });
  const admin = navegador();
  await admin.post('/api/auth/login', { email: 'admin@teste.local', senha: 'senha-admin-123' });

  let a = (await aline.get('/api/atendimento/atual')).json;
  assert.equal(a.cliente.nome, 'Ana Teste Ficticia');
  assert.equal(a.coeficientes.length, 18);
  assert.equal(a.coeficientesFicticios, true);
  assert.equal(a.resumo.naFila, 5);
  assert.equal((await aline.get('/api/atendimento/atual')).json.cliente.id, a.cliente.id, 'continua no mesmo cliente');

  let d = (await admin.get('/api/atendimento/atual')).json;
  assert.equal(d.cliente.nome, 'Bruno Exemplo Silva', 'a outra pessoa pega o próximo, nunca o mesmo');

  // Admin tenta finalizar o cliente que está com a Aline: recusado.
  let r = await admin.post('/api/atendimento/finalizar', { id: a.cliente.id, chave: a.cliente.chave, status: 'Consultado' });
  assert.equal(r.status, 409);
  r = await aline.post('/api/atendimento/finalizar', { id: a.cliente.id, chave: a.cliente.chave, status: 'Consultado', margemEmprestimo: '12a' });
  assert.equal(r.status, 400);
  r = await aline.post('/api/atendimento/finalizar', { id: a.cliente.id, chave: a.cliente.chave, status: 'Pendente' });
  assert.equal(r.status, 400);

  r = await aline.post('/api/atendimento/finalizar', {
    id: a.cliente.id, chave: a.cliente.chave, status: 'Consultado',
    margemEmprestimo: 'R$ 300,00', margemCartao: '50', telefone: '(96) 90000-9999', observacao: ' ligar sexta '
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.cliente.nome, 'Carla Modelo Souza');
  assert.equal(r.json.resumo.feitosHoje, 1);
  assert.equal(r.json.resumo.meusHoje, 1);

  const lista = (await aline.get('/api/clientes?busca=Ana')).json.clientes[0];
  assert.equal(lista.status, 'Consultado');
  assert.equal(lista.margem_emprestimo, 300);
  assert.equal(lista.melhor_emprestimo, 'Banco do Brasil — R$ 12.448,13 (96x)');
  assert.equal(lista.melhor_cartao, 'KardBank — R$ 1.400,00');
  assert.equal(lista.telefone, '(96) 90000-9999');
  assert.equal(lista.observacao, 'ligar sexta');
  const hist = (await aline.get(`/api/clientes/${lista.id}/historico`)).json.historico;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].usuario, 'Aline');

  // Finalizar duas vezes o mesmo cliente não grava em dobro.
  r = await aline.post('/api/atendimento/finalizar', { id: a.cliente.id, chave: a.cliente.chave, status: 'Consultado' });
  assert.equal(r.status, 409);

  // Pular e devolver.
  const carla = (await aline.get('/api/atendimento/atual')).json.cliente;
  r = await aline.post('/api/atendimento/finalizar', { id: carla.id, chave: carla.chave, status: 'Pulado' });
  assert.equal(r.json.resumo.feitosHoje, 1, 'pulado não conta como feito');
  assert.equal((await aline.post('/api/clientes/devolver-pulados')).json.devolvidos, 1);

  // Reimportar não apaga status nem margens.
  await aline.post('/api/importacoes', { base: 'Governo', csv: CSV_GOVERNO });
  const depois = (await aline.get('/api/clientes?busca=Ana')).json.clientes[0];
  assert.equal(depois.status, 'Consultado');
  assert.equal(depois.margem_emprestimo, 300);

  // Admin libera clientes presos em atendimento.
  assert.equal((await aline.post('/api/clientes/liberar-em-atendimento')).status, 403);
  assert.ok((await admin.post('/api/clientes/liberar-em-atendimento')).json.liberados >= 1);
});

test('coeficientes e configurações (admin)', async () => {
  const admin = navegador();
  await admin.post('/api/auth/login', { email: 'admin@teste.local', senha: 'senha-admin-123' });
  let r = await admin.put('/api/coeficientes', { coeficientes: [{ banco: 'NG', produto: 'emprestimo', prazo: '84', calculo: 'coeficiente', fator: '0' }] });
  assert.equal(r.status, 400);
  r = await admin.put('/api/coeficientes', {
    ficticios: false,
    coeficientes: [
      { banco: 'NG', produto: 'emprestimo', prazo: '84', calculo: 'coeficiente', fator: '0,0275', ativo: true },
      { banco: '', fator: '' },
      { banco: 'KardBank', produto: 'cartao', prazo: '', calculo: 'multiplicador', fator: 28, ativo: false }
    ]
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.coeficientes.length, 2);
  assert.equal(r.json.coeficientes[0].fator, 0.0275);
  assert.equal(r.json.ficticios, false);

  assert.equal((await admin.put('/api/configuracoes', { site_margem: 'javascript:alert(1)' })).status, 400);
  assert.equal((await admin.put('/api/configuracoes', { site_margem: 'https://margem.exemplo.gov.br' })).status, 200);
  assert.equal((await admin.get('/api/configuracoes')).json.site_margem, 'https://margem.exemplo.gov.br');
});

test('desativar usuária: derruba a sessão e devolve o cliente dela; não dá para ficar sem admin', async () => {
  const admin = navegador();
  await admin.post('/api/auth/login', { email: 'admin@teste.local', senha: 'senha-admin-123' });
  const aline = navegador();
  await aline.post('/api/auth/login', { email: 'aline@teste.local', senha: 'senha-nova-2' });
  const cli = (await aline.get('/api/atendimento/atual')).json.cliente;
  assert.ok(cli);

  const usuarios = (await admin.get('/api/usuarios')).json.usuarios;
  const idAline = usuarios.find(u => u.email === 'aline@teste.local').id;
  const idAdmin = usuarios.find(u => u.email === 'admin@teste.local').id;
  assert.equal((await admin.patch('/api/usuarios/' + idAdmin, { ativo: false })).status, 400);

  assert.equal((await admin.patch('/api/usuarios/' + idAline, { ativo: false })).status, 200);
  assert.equal((await aline.get('/api/auth/eu')).status, 401);
  assert.equal((await navegador().post('/api/auth/login', { email: 'aline@teste.local', senha: 'senha-nova-2' })).status, 401);
  const volta = (await admin.get('/api/clientes?busca=' + encodeURIComponent(cli.nome))).json.clientes[0];
  assert.equal(volta.status, 'Pendente');

  assert.equal((await admin.patch('/api/usuarios/' + idAline, { ativo: true })).status, 200);
});
