// Fila (lista de clientes) e importação de bases em CSV.
const express = require('express');
const db = require('../db');
const { logica } = require('../util');
const { lerCsv } = require('../csv');
const { exigirAdmin } = require('../seguranca');

const { STATUS, LISTA_STATUS, CAMPOS_CLIENTE, TITULOS_PADRAO, mapearColunas_, encontrarLinhaCabecalho_,
  mesclarFila_ } = logica;
const r = express.Router();

// ------------------------------------------------------------------ fila

r.get('/clientes', async (req, res) => {
  const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
  const porPagina = 50;
  const filtros = [];
  const params = [];
  if (req.query.status && LISTA_STATUS.includes(req.query.status)) {
    params.push(req.query.status);
    filtros.push(`c.status = $${params.length}`);
  }
  const busca = String(req.query.busca || '').trim();
  if (busca) {
    const digitos = busca.replace(/\D/g, '');
    params.push('%' + busca.replace(/[%_\\]/g, m => '\\' + m) + '%');
    let cond = `c.nome ILIKE $${params.length} OR c.matricula ILIKE $${params.length} OR c.orgao ILIKE $${params.length} OR c.origem ILIKE $${params.length}`;
    if (digitos.length >= 3) {
      params.push('%' + digitos + '%');
      cond += ` OR c.cpf LIKE $${params.length} OR regexp_replace(c.telefone, '\\D', '', 'g') LIKE $${params.length}`;
    }
    filtros.push('(' + cond + ')');
  }
  const where = filtros.length ? 'WHERE ' + filtros.join(' AND ') : '';
  const total = await db.query(`SELECT count(*)::int AS n FROM clientes c ${where}`, params);
  params.push(porPagina, (pagina - 1) * porPagina);
  const { rows } = await db.query(
    `SELECT c.id, c.nome, c.cpf, c.matricula, c.telefone, c.orgao, c.origem, c.status,
            c.margem_emprestimo, c.margem_cartao, c.melhor_emprestimo, c.melhor_cartao,
            c.observacao, c.atualizado_em, u.nome AS atendente
       FROM clientes c LEFT JOIN usuarios u ON u.id = c.atendente_id
       ${where} ORDER BY c.id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const contagem = await db.query('SELECT status, count(*)::int AS n FROM clientes GROUP BY status');
  res.json({
    clientes: rows.map(x => ({ ...x, id: Number(x.id) })),
    total: total.rows[0].n, pagina, porPagina,
    porStatus: Object.fromEntries(contagem.rows.map(x => [x.status, x.n]))
  });
});

r.post('/clientes/devolver-pulados', async (req, res) => {
  const { rowCount } = await db.query(
    'UPDATE clientes SET status = $1 WHERE status = $2', [STATUS.PENDENTE, STATUS.PULADO]);
  res.json({ devolvidos: rowCount });
});

/** Admin: devolve para a fila clientes presos "Em atendimento" (ex.: alguém fechou o navegador). */
r.post('/clientes/liberar-em-atendimento', exigirAdmin, async (req, res) => {
  const { rowCount } = await db.query(
    'UPDATE clientes SET status = $1, atendente_id = NULL WHERE status = $2', [STATUS.PENDENTE, STATUS.EM_ATENDIMENTO]);
  res.json({ liberados: rowCount });
});

r.get('/clientes/:id/historico', async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.status, a.margem_emprestimo, a.margem_cartao, a.melhor_emprestimo, a.melhor_cartao,
            a.observacao, a.criado_em, u.nome AS usuario
       FROM atendimentos a LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.cliente_id = $1 ORDER BY a.criado_em DESC`, [Number(req.params.id)]);
  res.json({ historico: rows });
});

// ------------------------------------------------------------------ importação

const LIMITE_LINHAS = 50000;

/** Lê o CSV e acha as colunas. Lança erro com mensagem para a tela. */
function analisar(corpo) {
  const base = String(corpo.base || '').trim().slice(0, 120);
  if (!base) throw Object.assign(new Error('Dê um nome para a base (ex.: "Governo", "Previdência").'), { status: 400 });
  const valores = lerCsv(corpo.csv);
  if (!valores.length) throw Object.assign(new Error('O arquivo está vazio.'), { status: 400 });
  if (valores.length > LIMITE_LINHAS) throw Object.assign(new Error(`Arquivo com mais de ${LIMITE_LINHAS} linhas. Divida em partes.`), { status: 400 });

  const colunasInformadas = corpo.colunas || {};
  const candidatos = {};
  CAMPOS_CLIENTE.forEach(campo => {
    const t = String(colunasInformadas[campo] || '').trim();
    candidatos[campo] = t ? [t] : TITULOS_PADRAO[campo];
  });
  const linhaTitulos = encontrarLinhaCabecalho_(valores, candidatos, 10);
  if (linhaTitulos < 0) throw Object.assign(new Error('Não achei a linha de títulos. Confira se o arquivo tem cabeçalho (Nome, CPF, Matrícula...).'), { status: 400 });
  const cabecalho = valores[linhaTitulos];
  const mapa = mapearColunas_(cabecalho, candidatos);
  if (mapa.nome < 0) throw Object.assign(new Error('Não achei a coluna de nome. Informe o título dela no campo "Coluna nome".'), { status: 400 });

  const avisos = [];
  CAMPOS_CLIENTE.forEach(campo => {
    if (mapa[campo] < 0 && String(colunasInformadas[campo] || '').trim()) avisos.push(`Coluna "${colunasInformadas[campo]}" não encontrada.`);
  });
  if (mapa.cpf < 0 && mapa.matricula < 0) avisos.push('Sem coluna de CPF nem de matrícula: clientes serão identificados por nome + base.');

  const entradas = [];
  for (let i = linhaTitulos + 1; i < valores.length; i++) {
    const v = valores[i];
    const c = { origem: base };
    CAMPOS_CLIENTE.forEach(campo => { c[campo] = mapa[campo] >= 0 ? (v[mapa[campo]] || '') : ''; });
    if (String(c.nome).trim() || String(c.cpf).trim() || String(c.matricula).trim()) entradas.push(c);
  }
  const colunasAchadas = {};
  CAMPOS_CLIENTE.forEach(campo => { colunasAchadas[campo] = mapa[campo] >= 0 ? cabecalho[mapa[campo]] : null; });
  return { base, entradas, colunasAchadas, cabecalho, avisos };
}

r.post('/importacoes/previa', async (req, res) => {
  const a = analisar(req.body || {});
  // Mostra só o necessário para conferir o mapeamento: 5 linhas.
  res.json({
    base: a.base, linhas: a.entradas.length, colunasAchadas: a.colunasAchadas,
    cabecalho: a.cabecalho, avisos: a.avisos, amostra: a.entradas.slice(0, 5)
  });
});

r.post('/importacoes', async (req, res) => {
  const a = analisar(req.body || {});
  const resultado = await db.transacao(async c => {
    // Trava a importação: duas ao mesmo tempo poderiam inserir a mesma chave.
    await c.query('SELECT pg_advisory_xact_lock(727275)');
    const chaves = [...new Set(a.entradas.map(e => logica.chaveCliente_(logica.limparCliente_(e), e.origem)).filter(Boolean))];
    const { rows } = await c.query(
      'SELECT id, chave, nome, cpf, matricula, telefone, orgao FROM clientes WHERE chave = ANY($1)', [chaves]);
    const existentes = rows.map(x => ({ ...x, id: Number(x.id) }));
    const antes = new Map(existentes.map(x => [x.id, JSON.stringify(CAMPOS_CLIENTE.map(k => x[k]))]));

    // A mesma regra da planilha: só completa campos vazios, nunca mexe em status/margens.
    const m = mesclarFila_(existentes, a.entradas);
    const novos = [];
    for (const l of m.linhas) {
      if (!l.id) { novos.push(l); continue; }
      if (antes.get(l.id) !== JSON.stringify(CAMPOS_CLIENTE.map(k => l[k]))) {
        await c.query('UPDATE clientes SET nome = $1, cpf = $2, matricula = $3, telefone = $4, orgao = $5 WHERE id = $6',
          [l.nome, l.cpf, l.matricula, l.telefone, l.orgao, l.id]);
      }
    }
    // Inserção em lotes (bases grandes).
    for (let i = 0; i < novos.length; i += 1000) {
      const lote = novos.slice(i, i + 1000);
      const col = k => lote.map(l => String(l[k] == null ? '' : l[k]));
      await c.query(
        `INSERT INTO clientes (chave, nome, cpf, matricula, telefone, orgao, origem, status)
         SELECT ch, n, cp, ma, te, o, ori, $8
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
             AS t(ch, n, cp, ma, te, o, ori)`,
        [col('chave'), col('nome'), col('cpf'), col('matricula'), col('telefone'), col('orgao'), col('origem'), STATUS.PENDENTE]);
    }
    await c.query(
      `INSERT INTO importacoes (base, arquivo, linhas_lidas, novos, completados, ignorados, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [a.base, String(req.body.arquivo || '').slice(0, 200), a.entradas.length, m.novos, m.completados, m.ignorados, req.usuario.id]);
    return { linhasLidas: a.entradas.length, novos: m.novos, completados: m.completados, ignorados: m.ignorados, avisos: a.avisos };
  });
  res.json(resultado);
});

r.get('/importacoes', async (req, res) => {
  const { rows } = await db.query(
    `SELECT i.base, i.arquivo, i.linhas_lidas, i.novos, i.completados, i.ignorados, i.criado_em, u.nome AS usuario
       FROM importacoes i LEFT JOIN usuarios u ON u.id = i.usuario_id ORDER BY i.criado_em DESC LIMIT 20`);
  res.json({ importacoes: rows });
});

module.exports = r;
