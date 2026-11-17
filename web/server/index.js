const { criarApp } = require('./app');
const { migrar } = require('./migrar');
const { semear } = require('./seed');
const db = require('./db');

async function aguardarBanco(tentativas = 30) {
  for (let i = 1; i <= tentativas; i++) {
    try { await db.query('SELECT 1'); return; } catch (e) {
      if (i === tentativas) throw e;
      console.log(`[db] aguardando o banco (${i}/${tentativas})…`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function iniciar() {
  await aguardarBanco();
  await migrar();
  await semear();
  // Limpeza diária de sessões e links vencidos.
  const limpar = () => Promise.all([
    db.query('DELETE FROM sessoes WHERE expira_em < now()'),
    db.query("DELETE FROM redefinicoes_senha WHERE expira_em < now() - interval '7 days'")
  ]).catch(e => console.error('[limpeza]', e.message));
  limpar();
  setInterval(limpar, 24 * 3600 * 1000).unref();

  const porta = Number(process.env.PORT || 3000);
  const servidor = criarApp().listen(porta, () => console.log(`[web] Painel de Atendimento em http://localhost:${porta}`));
  const desligar = () => servidor.close(() => db.pool.end().then(() => process.exit(0)));
  process.on('SIGTERM', desligar);
  process.on('SIGINT', desligar);
}

iniciar().catch(e => { console.error(e); process.exit(1); });
