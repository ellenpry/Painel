// Senhas, tokens e sessões. Só usa o crypto nativo do Node.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const db = require('./db');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, tamanho: 64 };
const SENHA_MINIMA = 8;
const SESSAO_DIAS = 7;
const COOKIE = 'painel_sessao';

async function gerarHashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const hash = await scrypt(senha, sal, SCRYPT.tamanho, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, sal.toString('base64'), hash.toString('base64')].join('$');
}

async function conferirSenha(senha, guardado) {
  const partes = String(guardado || '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, N, r, p, sal, hash] = partes;
  const esperado = Buffer.from(hash, 'base64');
  const calculado = await scrypt(String(senha), Buffer.from(sal, 'base64'), esperado.length,
    { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(esperado, calculado);
}

/** Hash fixo para gastar o mesmo tempo quando o e-mail não existe (não revela quem tem conta). */
let hashFalso;
async function conferirSenhaFalsa(senha) {
  hashFalso = hashFalso || await gerarHashSenha('senha-que-ninguem-usa');
  await conferirSenha(senha, hashFalso);
  return false;
}

function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < SENHA_MINIMA) return `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
  if (senha.length > 200) return 'Senha longa demais.';
  return null;
}

function novoToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// ------------------------------------------------------------------ sessões

async function criarSessao(res, req, usuarioId, cliente = db) {
  const token = novoToken();
  await cliente.query(
    `INSERT INTO sessoes (token_hash, usuario_id, expira_em, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)`,
    [hashToken(token), usuarioId, SESSAO_DIAS, req.ip, String(req.get('user-agent') || '').slice(0, 300)]);
  await cliente.query('UPDATE usuarios SET ultimo_login_em = now() WHERE id = $1', [usuarioId]);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: process.env.COOKIE_SAMESITE === 'none' ? 'none' : 'lax',
    secure: process.env.COOKIE_SECURE === 'true' || process.env.COOKIE_SAMESITE === 'none',
    maxAge: SESSAO_DIAS * 24 * 3600 * 1000,
    path: '/'
  });
}

function lerCookie(req, nome) {
  const cabecalho = req.headers.cookie || '';
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

async function encerrarSessao(req, res) {
  const token = lerCookie(req, COOKIE);
  if (token) await db.query('DELETE FROM sessoes WHERE token_hash = $1', [hashToken(token)]);
  res.clearCookie(COOKIE, { path: '/' });
}

/** Middleware: coloca req.usuario se houver sessão válida de usuário ativo. */
async function carregarUsuario(req, res, next) {
  try {
    const token = lerCookie(req, COOKIE);
    if (token) {
      const { rows } = await db.query(
        `SELECT u.id, u.nome, u.email, u.papel
           FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
          WHERE s.token_hash = $1 AND s.expira_em > now() AND u.ativo`, [hashToken(token)]);
      req.usuario = rows[0] || null;
    }
    next();
  } catch (e) { next(e); }
}

function exigirLogin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: 'Faça login para continuar.' });
  next();
}

function exigirAdmin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: 'Faça login para continuar.' });
  if (req.usuario.papel !== 'admin') return res.status(403).json({ erro: 'Só administradores podem fazer isso.' });
  next();
}

/**
 * Proteção contra CSRF: requisições que alteram dados precisam do cabeçalho X-Requested-With.
 * Um formulário de outro site não consegue enviar cabeçalho personalizado sem CORS, que não liberamos.
 */
function exigirCabecalhoAjax(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'painel') return res.status(403).json({ erro: 'Requisição recusada.' });
  next();
}

// ------------------------------------------------------------------ limite de tentativas

/** Limite simples em memória (uma instância). chave -> [instantes]. */
function limitador({ maximo, janelaMs }) {
  const tentativas = new Map();
  return {
    excedeu(chave) {
      const agora = Date.now();
      const lista = (tentativas.get(chave) || []).filter(t => agora - t < janelaMs);
      tentativas.set(chave, lista);
      return lista.length >= maximo;
    },
    registrar(chave) {
      const lista = tentativas.get(chave) || [];
      lista.push(Date.now());
      tentativas.set(chave, lista);
    },
    limpar(chave) { tentativas.delete(chave); }
  };
}

module.exports = {
  COOKIE, SENHA_MINIMA, gerarHashSenha, conferirSenha, conferirSenhaFalsa, validarSenha,
  novoToken, hashToken, criarSessao, encerrarSessao, carregarUsuario,
  exigirLogin, exigirAdmin, exigirCabecalhoAjax, limitador
};
