// Login, sessão, recuperação de senha e aceite de convite (rotas públicas).
const express = require('express');
const db = require('../db');
const s = require('../seguranca');
const email = require('../email');
const { urlBase } = require('../util');

const REDEFINICAO_MINUTOS = 60;
const limiteLogin = s.limitador({ maximo: 10, janelaMs: 15 * 60 * 1000 });
const limiteEsqueci = s.limitador({ maximo: 5, janelaMs: 15 * 60 * 1000 });

const r = express.Router();

function emailValido(e) {
  return typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

r.post('/login', async (req, res) => {
  const emailInformado = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  const chave = req.ip + '|' + emailInformado;
  if (limiteLogin.excedeu(chave)) {
    return res.status(429).json({ erro: 'Muitas tentativas. Espere alguns minutos ou use "Esqueci minha senha".' });
  }
  const { rows } = await db.query('SELECT id, senha_hash, ativo FROM usuarios WHERE email = $1', [emailInformado]);
  const u = rows[0];
  const ok = u ? await s.conferirSenha(senha, u.senha_hash) : await s.conferirSenhaFalsa(senha);
  if (!ok || !u.ativo) {
    limiteLogin.registrar(chave);
    return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  }
  limiteLogin.limpar(chave);
  await s.criarSessao(res, req, u.id);
  res.json({ ok: true });
});

r.post('/logout', async (req, res) => {
  await s.encerrarSessao(req, res);
  res.json({ ok: true });
});

r.get('/eu', (req, res) => {
  if (!req.usuario) return res.status(401).json({ erro: 'Sem sessão.' });
  res.json({ usuario: req.usuario });
});

// ------------------------------------------------------------------ esqueci minha senha

r.post('/esqueci-senha', async (req, res) => {
  const resposta = { ok: true, mensagem: 'Se este e-mail tiver uma conta ativa, enviamos um link para criar uma nova senha.' };
  const emailInformado = String(req.body.email || '').trim().toLowerCase();
  if (!emailValido(emailInformado)) return res.status(400).json({ erro: 'Informe um e-mail válido.' });
  if (limiteEsqueci.excedeu(req.ip + '|' + emailInformado)) return res.json(resposta);
  limiteEsqueci.registrar(req.ip + '|' + emailInformado);

  const { rows } = await db.query('SELECT id, nome, email FROM usuarios WHERE email = $1 AND ativo', [emailInformado]);
  const u = rows[0];
  // Mesma resposta exista ou não a conta, para não revelar quem está cadastrado.
  if (!u) return res.json(resposta);

  const token = s.novoToken();
  await db.transacao(async c => {
    // Um pedido novo invalida os anteriores.
    await c.query('UPDATE redefinicoes_senha SET usado_em = now() WHERE usuario_id = $1 AND usado_em IS NULL', [u.id]);
    await c.query(`INSERT INTO redefinicoes_senha (usuario_id, token_hash, expira_em)
                   VALUES ($1, $2, now() + make_interval(mins => $3))`, [u.id, s.hashToken(token), REDEFINICAO_MINUTOS]);
  });
  try {
    await email.enviarRedefinicao({
      para: u.email, nome: u.nome, minutos: REDEFINICAO_MINUTOS,
      link: `${urlBase(req)}/redefinir-senha?token=${encodeURIComponent(token)}`
    });
  } catch (e) {
    console.error('[email] falha ao enviar redefinição:', e.message);
  }
  res.json(resposta);
});

async function buscarRedefinicao(token) {
  const { rows } = await db.query(
    `SELECT r.id, r.usuario_id, u.email FROM redefinicoes_senha r JOIN usuarios u ON u.id = r.usuario_id
      WHERE r.token_hash = $1 AND r.usado_em IS NULL AND r.expira_em > now() AND u.ativo`, [s.hashToken(token)]);
  return rows[0] || null;
}

r.get('/redefinir-senha/:token', async (req, res) => {
  const red = await buscarRedefinicao(req.params.token);
  if (!red) return res.status(404).json({ erro: 'Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".' });
  res.json({ email: red.email });
});

r.post('/redefinir-senha', async (req, res) => {
  const erroSenha = s.validarSenha(req.body.senha);
  if (erroSenha) return res.status(400).json({ erro: erroSenha });
  const red = await buscarRedefinicao(String(req.body.token || ''));
  if (!red) return res.status(404).json({ erro: 'Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".' });
  const hash = await s.gerarHashSenha(req.body.senha);
  await db.transacao(async c => {
    const marcado = await c.query('UPDATE redefinicoes_senha SET usado_em = now() WHERE id = $1 AND usado_em IS NULL', [red.id]);
    if (!marcado.rowCount) throw Object.assign(new Error('Link já usado.'), { status: 409 });
    await c.query('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [hash, red.usuario_id]);
    // Senha nova derruba todas as sessões abertas (ex.: num computador esquecido logado).
    await c.query('DELETE FROM sessoes WHERE usuario_id = $1', [red.usuario_id]);
    await s.criarSessao(res, req, red.usuario_id, c);
  });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ convites

async function buscarConvite(token, cliente = db) {
  const { rows } = await cliente.query(
    `SELECT id, email, papel FROM convites
      WHERE token_hash = $1 AND usado_em IS NULL AND cancelado_em IS NULL AND expira_em > now()`, [s.hashToken(token)]);
  return rows[0] || null;
}

r.get('/convites/:token', async (req, res) => {
  const conv = await buscarConvite(req.params.token);
  if (!conv) return res.status(404).json({ erro: 'Este convite expirou, foi cancelado ou já foi usado. Peça um novo a quem convidou você.' });
  res.json({ email: conv.email, papel: conv.papel });
});

r.post('/convites/aceitar', async (req, res) => {
  const nome = String(req.body.nome || '').trim().replace(/\s+/g, ' ');
  if (nome.length < 2 || nome.length > 120) return res.status(400).json({ erro: 'Informe seu nome.' });
  const erroSenha = s.validarSenha(req.body.senha);
  if (erroSenha) return res.status(400).json({ erro: erroSenha });
  const hash = await s.gerarHashSenha(req.body.senha);

  await db.transacao(async c => {
    const conv = await buscarConvite(String(req.body.token || ''), c);
    if (!conv) throw Object.assign(new Error('Este convite expirou, foi cancelado ou já foi usado.'), { status: 404 });
    const existe = await c.query('SELECT 1 FROM usuarios WHERE email = $1', [conv.email]);
    if (existe.rowCount) throw Object.assign(new Error('Já existe uma conta com este e-mail. Use "Entrar".'), { status: 409 });
    const marcado = await c.query('UPDATE convites SET usado_em = now() WHERE id = $1 AND usado_em IS NULL', [conv.id]);
    if (!marcado.rowCount) throw Object.assign(new Error('Convite já usado.'), { status: 409 });
    const { rows } = await c.query(
      'INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES ($1, $2, $3, $4) RETURNING id',
      [nome, conv.email, hash, conv.papel]);
    await s.criarSessao(res, req, rows[0].id, c);
  });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ minha conta

r.post('/trocar-senha', s.exigirLogin, async (req, res) => {
  const erroSenha = s.validarSenha(req.body.novaSenha);
  if (erroSenha) return res.status(400).json({ erro: erroSenha });
  const { rows } = await db.query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
  if (!(await s.conferirSenha(String(req.body.senhaAtual || ''), rows[0].senha_hash))) {
    return res.status(400).json({ erro: 'A senha atual está incorreta.' });
  }
  const hash = await s.gerarHashSenha(req.body.novaSenha);
  await db.transacao(async c => {
    await c.query('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [hash, req.usuario.id]);
    await c.query('DELETE FROM sessoes WHERE usuario_id = $1', [req.usuario.id]);
    await s.criarSessao(res, req, req.usuario.id, c);
  });
  res.json({ ok: true });
});

module.exports = r;
