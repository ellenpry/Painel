// Um cliente por vez: cada usuário tem no máximo um cliente "Em atendimento".
const express = require('express');
const db = require('../db');
const { logica } = require('../util');
const { lerCoeficientes, lerConfiguracoes, resumo } = require('../dados');

const { STATUS, STATUS_FINAIS, numero_, simular_, descreverMelhor_ } = logica;
const r = express.Router();

const CAMPOS = `id, chave, nome, cpf, matricula, telefone, orgao, origem, status,
  margem_emprestimo, margem_cartao, observacao`;

function paraPainel(c) {
  if (!c) return null;
  return {
    id: Number(c.id), chave: c.chave, nome: c.nome, cpf: c.cpf, matricula: c.matricula,
    telefone: c.telefone, orgao: c.orgao, origem: c.origem, observacao: c.observacao,
    margemEmprestimo: c.margem_emprestimo, margemCartao: c.margem_cartao
  };
}

/**
 * Cliente atual do usuário. Se ele não tiver um "Em atendimento", pega o primeiro Pendente.
 * FOR UPDATE SKIP LOCKED evita que duas pessoas peguem o mesmo cliente ao mesmo tempo.
 */
async function clienteAtual(c, usuarioId) {
  const atual = await c.query(
    `SELECT ${CAMPOS} FROM clientes WHERE status = $1 AND atendente_id = $2 ORDER BY id LIMIT 1`,
    [STATUS.EM_ATENDIMENTO, usuarioId]);
  if (atual.rows[0]) return atual.rows[0];
  const pego = await c.query(
    `UPDATE clientes SET status = $1, atendente_id = $2
      WHERE id = (SELECT id FROM clientes WHERE status = $3 ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING ${CAMPOS}`, [STATUS.EM_ATENDIMENTO, usuarioId, STATUS.PENDENTE]);
  return pego.rows[0] || null;
}

async function montarResposta(c, usuarioId) {
  const cliente = await clienteAtual(c, usuarioId);
  // Em sequência: as consultas usam a mesma conexão da transação.
  const coeficientes = await lerCoeficientes(c);
  const config = await lerConfiguracoes(c);
  const numeros = await resumo(usuarioId, c);
  return {
    cliente: paraPainel(cliente),
    links: { margem: config.site_margem, lemitti: config.lemitti },
    coeficientesFicticios: config.coeficientes_ficticios === 'sim',
    coeficientes,
    resumo: numeros
  };
}

r.get('/atual', async (req, res) => {
  res.json(await db.transacao(c => montarResposta(c, req.usuario.id)));
});

r.post('/finalizar', async (req, res) => {
  const d = req.body || {};
  if (!STATUS_FINAIS.includes(d.status)) return res.status(400).json({ erro: 'Status inválido.' });
  const margemEmp = numero_(d.margemEmprestimo);
  const margemCartao = numero_(d.margemCartao);
  if ((String(d.margemEmprestimo || '').trim() && margemEmp == null) || (String(d.margemCartao || '').trim() && margemCartao == null)) {
    return res.status(400).json({ erro: 'Margem em formato não reconhecido.' });
  }
  if ((margemEmp != null && margemEmp < 0) || (margemCartao != null && margemCartao < 0)) {
    return res.status(400).json({ erro: 'Margem não pode ser negativa.' });
  }

  const resposta = await db.transacao(async c => {
    // O servidor recalcula a melhor proposta: não confia no valor que veio do navegador.
    const sim = simular_(await lerCoeficientes(c), margemEmp, margemCartao);
    const melhorEmp = descreverMelhor_(sim.emprestimo[0]);
    const melhorCartao = descreverMelhor_(sim.cartao[0]);
    const obs = String(d.observacao == null ? '' : d.observacao).trim().slice(0, 2000);

    // Só grava se o cliente ainda está com este usuário (equivale a conferir a chave da linha).
    const upd = await c.query(
      `UPDATE clientes SET status = $1, margem_emprestimo = $2, margem_cartao = $3,
              melhor_emprestimo = $4, melhor_cartao = $5, observacao = $6,
              telefone = COALESCE($7, telefone), atendente_id = NULL, atualizado_em = now()
        WHERE id = $8 AND chave = $9 AND status = $10 AND atendente_id = $11
        RETURNING id`,
      [d.status, margemEmp, margemCartao, melhorEmp, melhorCartao, obs,
        d.telefone == null ? null : String(d.telefone).trim().slice(0, 100),
        Number(d.id), String(d.chave || ''), STATUS.EM_ATENDIMENTO, req.usuario.id]);
    if (!upd.rowCount) {
      throw Object.assign(new Error('Este cliente não está mais com você (foi liberado ou finalizado em outra tela). Nada foi gravado.'), { status: 409 });
    }
    await c.query(
      `INSERT INTO atendimentos (cliente_id, usuario_id, status, margem_emprestimo, margem_cartao, melhor_emprestimo, melhor_cartao, observacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [Number(d.id), req.usuario.id, d.status, margemEmp, margemCartao, melhorEmp, melhorCartao, obs]);
    return montarResposta(c, req.usuario.id);
  });
  res.json(resposta);
});

module.exports = r;
