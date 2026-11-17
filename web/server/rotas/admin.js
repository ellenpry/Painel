// Coeficientes, configurações, usuários e convites.
const express = require('express');
const db = require('../db');
const s = require('../seguranca');
const email = require('../email');
const { urlBase, logica } = require('../util');
const { lerCoeficientes, lerConfiguracoes } = require('../dados');

const CONVITE_DIAS = 7;
const r = express.Router();

// ------------------------------------------------------------------ coeficientes

r.get('/coeficientes', async (req, res) => {
  const config = await lerConfiguracoes();
  res.json({ coeficientes: await lerCoeficientes(), ficticios: config.coeficientes_ficticios === 'sim' });
});

/** Substitui a tabela inteira (a tela edita tudo de uma vez). */
r.put('/coeficientes', s.exigirAdmin, async (req, res) => {
  const lista = Array.isArray(req.body.coeficientes) ? req.body.coeficientes : null;
  if (!lista) return res.status(400).json({ erro: 'Lista de coeficientes ausente.' });
  if (lista.length > 500) return res.status(400).json({ erro: 'Linhas demais.' });
  const limpos = [];
  for (let i = 0; i < lista.length; i++) {
    const c = lista[i] || {};
    const banco = String(c.banco || '').trim().slice(0, 80);
    const fator = logica.numero_(c.fator);
    if (!banco && (c.fator === '' || c.fator == null)) continue; // linha em branco
    if (!banco) return res.status(400).json({ erro: `Linha ${i + 1}: informe o banco.` });
    if (!(fator > 0)) return res.status(400).json({ erro: `Linha ${i + 1} (${banco}): o fator precisa ser um número maior que zero.` });
    if (!['emprestimo', 'cartao'].includes(c.produto)) return res.status(400).json({ erro: `Linha ${i + 1}: produto inválido.` });
    if (!['coeficiente', 'multiplicador'].includes(c.calculo)) return res.status(400).json({ erro: `Linha ${i + 1}: cálculo inválido.` });
    limpos.push([banco, c.produto, String(c.prazo == null ? '' : c.prazo).trim().slice(0, 30), c.calculo, fator, c.ativo !== false, limpos.length]);
  }
  await db.transacao(async c => {
    await c.query('DELETE FROM coeficientes');
    for (const l of limpos) {
      await c.query('INSERT INTO coeficientes (banco, produto, prazo, calculo, fator, ativo, ordem) VALUES ($1,$2,$3,$4,$5,$6,$7)', l);
    }
    await c.query(`INSERT INTO configuracoes (chave, valor) VALUES ('coeficientes_ficticios', $1)
                   ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`, [req.body.ficticios ? 'sim' : 'nao']);
  });
  res.json({ coeficientes: await lerCoeficientes(), ficticios: !!req.body.ficticios });
});

// ------------------------------------------------------------------ configurações

const CHAVES_CONFIG = ['site_margem', 'lemitti'];

r.get('/configuracoes', async (req, res) => {
  const c = await lerConfiguracoes();
  res.json({ site_margem: c.site_margem, lemitti: c.lemitti });
});

r.put('/configuracoes', s.exigirAdmin, async (req, res) => {
  for (const chave of CHAVES_CONFIG) {
    if (req.body[chave] == null) continue;
    const valor = String(req.body[chave]).trim().slice(0, 500);
    if (valor && !/^https?:\/\//i.test(valor)) return res.status(400).json({ erro: 'Os links precisam começar com http:// ou https://' });
    await db.query(`INSERT INTO configuracoes (chave, valor) VALUES ($1, $2)
                    ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`, [chave, valor]);
  }
  res.json({ ok: true });
});

// ------------------------------------------------------------------ usuários

r.get('/usuarios', s.exigirAdmin, async (req, res) => {
  const usuarios = await db.query(
    'SELECT id, nome, email, papel, ativo, criado_em, ultimo_login_em FROM usuarios ORDER BY ativo DESC, nome');
  const convites = await db.query(
    `SELECT c.id, c.email, c.papel, c.criado_em, c.expira_em, u.nome AS criado_por
       FROM convites c LEFT JOIN usuarios u ON u.id = c.criado_por
      WHERE c.usado_em IS NULL AND c.cancelado_em IS NULL AND c.expira_em > now()
      ORDER BY c.criado_em DESC`);
  res.json({
    usuarios: usuarios.rows.map(u => ({ ...u, id: Number(u.id) })),
    convites: convites.rows.map(c => ({ ...c, id: Number(c.id) }))
  });
});

r.patch('/usuarios/:id', s.exigirAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.usuario.id) return res.status(400).json({ erro: 'Você não pode alterar o próprio acesso por aqui.' });
  const campos = [], params = [];
  if (typeof req.body.ativo === 'boolean') { params.push(req.body.ativo); campos.push(`ativo = $${params.length}`); }
  if (['admin', 'atendente'].includes(req.body.papel)) { params.push(req.body.papel); campos.push(`papel = $${params.length}`); }
  if (!campos.length) return res.status(400).json({ erro: 'Nada para alterar.' });
  params.push(id);
  await db.transacao(async c => {
    const upd = await c.query(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = $${params.length}`, params);
    if (!upd.rowCount) throw Object.assign(new Error('Usuário não encontrado.'), { status: 404 });
    if (req.body.ativo === false) {
      // Desativado: sai de todas as sessões e o cliente que estava com ele volta para a fila.
      await c.query('DELETE FROM sessoes WHERE usuario_id = $1', [id]);
      await c.query(`UPDATE clientes SET status = 'Pendente', atendente_id = NULL
                      WHERE atendente_id = $1 AND status = 'Em atendimento'`, [id]);
    }
    const admins = await c.query("SELECT count(*)::int AS n FROM usuarios WHERE papel = 'admin' AND ativo");
    if (!admins.rows[0].n) throw Object.assign(new Error('Precisa sobrar pelo menos um administrador ativo.'), { status: 400 });
  });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ convites

async function criarConvite(req, emailConvidado, papel) {
  const token = s.novoToken();
  await db.transacao(async c => {
    // Convite novo para o mesmo e-mail cancela os anteriores.
    await c.query('UPDATE convites SET cancelado_em = now() WHERE email = $1 AND usado_em IS NULL AND cancelado_em IS NULL', [emailConvidado]);
    await c.query(
      `INSERT INTO convites (email, papel, token_hash, criado_por, expira_em)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`,
      [emailConvidado, papel, s.hashToken(token), req.usuario.id, CONVITE_DIAS]);
  });
  const link = `${urlBase(req)}/convite?token=${encodeURIComponent(token)}`;
  let emailEnviado = true;
  try {
    await email.enviarConvite({ para: emailConvidado, link, convidadoPor: req.usuario.nome, horas: CONVITE_DIAS * 24 });
  } catch (e) {
    emailEnviado = false;
    console.error('[email] falha ao enviar convite:', e.message);
  }
  // O link também volta para a tela: dá para mandar por WhatsApp se o e-mail falhar.
  return { link, emailEnviado, expiraEmDias: CONVITE_DIAS };
}

r.post('/convites', s.exigirAdmin, async (req, res) => {
  const emailConvidado = String(req.body.email || '').trim().toLowerCase();
  const papel = req.body.papel === 'admin' ? 'admin' : 'atendente';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailConvidado) || emailConvidado.length > 254) {
    return res.status(400).json({ erro: 'Informe um e-mail válido.' });
  }
  const existe = await db.query('SELECT 1 FROM usuarios WHERE email = $1', [emailConvidado]);
  if (existe.rowCount) return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });
  res.json(await criarConvite(req, emailConvidado, papel));
});

r.post('/convites/:id/reenviar', s.exigirAdmin, async (req, res) => {
  const { rows } = await db.query(
    'SELECT email, papel FROM convites WHERE id = $1 AND usado_em IS NULL AND cancelado_em IS NULL', [Number(req.params.id)]);
  if (!rows[0]) return res.status(404).json({ erro: 'Convite não encontrado.' });
  res.json(await criarConvite(req, rows[0].email, rows[0].papel));
});

r.delete('/convites/:id', s.exigirAdmin, async (req, res) => {
  await db.query('UPDATE convites SET cancelado_em = now() WHERE id = $1 AND usado_em IS NULL', [Number(req.params.id)]);
  res.json({ ok: true });
});

module.exports = r;
