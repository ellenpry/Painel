const { Pool, types } = require('pg');

// numeric chega como string no pg; aqui viramos número (margens e fatores cabem em double).
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://painel:painel@localhost:5432/painel',
  max: 10
});

/** Roda fn(client) numa transação. */
async function transacao(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query: (t, p) => pool.query(t, p), transacao };
