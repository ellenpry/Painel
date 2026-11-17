// Aplica, em ordem, os arquivos de server/migrations que ainda não rodaram.
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('./db');

async function migrar() {
  const client = await pool.connect();
  try {
    // Trava para duas instâncias não migrarem ao mesmo tempo.
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query('SELECT nome FROM schema_migrations');
    const feitas = new Set(rows.map(r => r.nome));
    const dir = path.join(__dirname, 'migrations');
    const arquivos = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    for (const arq of arquivos) {
      if (feitas.has(arq)) continue;
      const sql = fs.readFileSync(path.join(dir, arq), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [arq]);
        await client.query('COMMIT');
        console.log('[migração] aplicada', arq);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migração ${arq} falhou: ${e.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
}

if (require.main === module) {
  migrar().then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { migrar };
