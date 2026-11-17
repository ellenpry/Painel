// Gera um convite pela linha de comando (útil para o primeiro acesso ou se o e-mail falhar).
// Uso: npm run convite -- pessoa@exemplo.com [admin|atendente]
// No Docker: docker compose exec web npm run convite -- pessoa@exemplo.com admin
const db = require('./db');
const s = require('./seguranca');

async function principal() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  const papel = process.argv[3] === 'admin' ? 'admin' : 'atendente';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Uso: npm run convite -- pessoa@exemplo.com [admin|atendente]');
    process.exit(1);
  }
  const existe = await db.query('SELECT 1 FROM usuarios WHERE email = $1', [email]);
  if (existe.rowCount) throw new Error('Já existe uma conta com este e-mail.');
  const token = s.novoToken();
  await db.query('UPDATE convites SET cancelado_em = now() WHERE email = $1 AND usado_em IS NULL AND cancelado_em IS NULL', [email]);
  await db.query(`INSERT INTO convites (email, papel, token_hash, expira_em) VALUES ($1, $2, $3, now() + interval '7 days')`,
    [email, papel, s.hashToken(token)]);
  const base = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
  console.log(`Convite (${papel}) para ${email}, válido por 7 dias:\n${base}/convite?token=${token}`);
}

principal().then(() => db.pool.end()).catch(e => { console.error(e.message); process.exit(1); });
