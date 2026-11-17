// Consultas compartilhadas entre rotas.
const db = require('./db');

const FUSO = 'America/Belem';

async function lerCoeficientes(cliente = db) {
  const { rows } = await cliente.query(
    'SELECT id, banco, produto, prazo, calculo, fator, ativo FROM coeficientes ORDER BY ordem, id');
  return rows.map(r => ({ ...r, id: Number(r.id) }));
}

async function lerConfiguracoes(cliente = db) {
  const { rows } = await cliente.query('SELECT chave, valor FROM configuracoes');
  const c = { site_margem: '', lemitti: 'https://lemitti.com', coeficientes_ficticios: 'nao' };
  rows.forEach(r => { c[r.chave] = r.valor; });
  return c;
}

/** Números do topo: na fila (Pendente + Em atendimento), feitos hoje (equipe e você). */
async function resumo(usuarioId, cliente = db) {
  const { rows } = await cliente.query(`
    SELECT
      (SELECT count(*) FROM clientes WHERE status IN ('Pendente', 'Em atendimento'))::int AS na_fila,
      (SELECT count(*) FROM atendimentos
        WHERE status IN ('Consultado', 'Sem margem')
          AND (criado_em AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date)::int AS feitos_hoje,
      (SELECT count(*) FROM atendimentos
        WHERE status IN ('Consultado', 'Sem margem') AND usuario_id = $1
          AND (criado_em AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date)::int AS meus_hoje`,
  [usuarioId, FUSO]);
  return { naFila: rows[0].na_fila, feitosHoje: rows[0].feitos_hoje, meusHoje: rows[0].meus_hoje };
}

module.exports = { FUSO, lerCoeficientes, lerConfiguracoes, resumo };
