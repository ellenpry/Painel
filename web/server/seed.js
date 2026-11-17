// Dados iniciais: configurações, coeficientes fictícios e o primeiro administrador.
const db = require('./db');
const s = require('./seguranca');

// VALORES FICTÍCIOS (os mesmos da planilha): trocar pelos coeficientes reais na tela Coeficientes.
const BANCOS = [
  ['Santander', 0.0262, 0.0247, 26.5],
  ['Banco do Brasil', 0.0255, 0.0241, 27.0],
  ['Industrial', 0.0270, 0.0255, 25.0],
  ['NIO', 0.0268, 0.0250, 24.5],
  ['NG', 0.0275, 0.0259, 25.5],
  ['KardBank', 0.0280, 0.0262, 28.0]
];

async function semear({ log = console.log } = {}) {
  await db.query(`INSERT INTO configuracoes (chave, valor) VALUES
    ('site_margem', ''), ('lemitti', 'https://lemitti.com'), ('coeficientes_ficticios', 'sim')
    ON CONFLICT (chave) DO NOTHING`);

  const { rows: [{ n: qtdCoef }] } = await db.query('SELECT count(*)::int AS n FROM coeficientes');
  if (!qtdCoef) {
    let ordem = 0;
    for (const [banco, c84, c96, mult] of BANCOS) {
      await db.query('INSERT INTO coeficientes (banco, produto, prazo, calculo, fator, ordem) VALUES ($1,$2,$3,$4,$5,$6)', [banco, 'emprestimo', '84', 'coeficiente', c84, ordem++]);
      await db.query('INSERT INTO coeficientes (banco, produto, prazo, calculo, fator, ordem) VALUES ($1,$2,$3,$4,$5,$6)', [banco, 'emprestimo', '96', 'coeficiente', c96, ordem++]);
      await db.query('INSERT INTO coeficientes (banco, produto, prazo, calculo, fator, ordem) VALUES ($1,$2,$3,$4,$5,$6)', [banco, 'cartao', '', 'multiplicador', mult, ordem++]);
    }
    log('[seed] coeficientes fictícios criados');
  }

  // Primeiro administrador. Só roda com o banco sem nenhum usuário.
  const { rows: [{ n: qtdUsuarios }] } = await db.query('SELECT count(*)::int AS n FROM usuarios');
  const emailAdmin = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!qtdUsuarios && emailAdmin) {
    if (process.env.ADMIN_SENHA) {
      const erro = s.validarSenha(process.env.ADMIN_SENHA);
      if (erro) throw new Error('ADMIN_SENHA: ' + erro);
      await db.query('INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES ($1, $2, $3, $4)',
        [process.env.ADMIN_NOME || 'Administrador', emailAdmin, await s.gerarHashSenha(process.env.ADMIN_SENHA), 'admin']);
      log(`[seed] administrador criado: ${emailAdmin}`);
    } else {
      // Sem senha definida: gera um convite de administrador e mostra o link no log.
      const token = s.novoToken();
      await db.query(`INSERT INTO convites (email, papel, token_hash, expira_em) VALUES ($1, 'admin', $2, now() + interval '7 days')`,
        [emailAdmin, s.hashToken(token)]);
      const base = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
      log(`[seed] convite do primeiro administrador (${emailAdmin}): ${base}/convite?token=${token}`);
    }
  } else if (!qtdUsuarios) {
    log('[seed] nenhum usuário e ADMIN_EMAIL vazio: defina ADMIN_EMAIL no .env ou rode "npm run convite -- email@exemplo.com admin"');
  }
}

module.exports = { semear };
