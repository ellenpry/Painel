-- Painel de Atendimento — esquema inicial.
-- Fuso de referência para "hoje": America/Belem (Amapá).

CREATE EXTENSION IF NOT EXISTS citext;

-- ------------------------------------------------------------------ acesso

CREATE TABLE usuarios (
  id              bigserial PRIMARY KEY,
  nome            text        NOT NULL,
  email           citext      NOT NULL UNIQUE,
  senha_hash      text        NOT NULL,
  papel           text        NOT NULL DEFAULT 'atendente' CHECK (papel IN ('admin', 'atendente')),
  ativo           boolean     NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  ultimo_login_em timestamptz
);

-- Só quem tem convite cria conta. O token vai por e-mail/link; aqui fica só o hash.
CREATE TABLE convites (
  id          bigserial PRIMARY KEY,
  email       citext      NOT NULL,
  papel       text        NOT NULL DEFAULT 'atendente' CHECK (papel IN ('admin', 'atendente')),
  token_hash  text        NOT NULL UNIQUE,
  criado_por  bigint      REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  expira_em   timestamptz NOT NULL,
  usado_em    timestamptz,
  cancelado_em timestamptz
);
CREATE INDEX convites_email_idx ON convites (email);

CREATE TABLE redefinicoes_senha (
  id          bigserial PRIMARY KEY,
  usuario_id  bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  expira_em   timestamptz NOT NULL,
  usado_em    timestamptz
);

CREATE TABLE sessoes (
  token_hash  text        PRIMARY KEY,
  usuario_id  bigint      NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  expira_em   timestamptz NOT NULL,
  ip          text,
  user_agent  text
);
CREATE INDEX sessoes_usuario_idx ON sessoes (usuario_id);

-- ------------------------------------------------------------------ configuração

CREATE TABLE configuracoes (
  chave  text PRIMARY KEY,
  valor  text NOT NULL DEFAULT ''
);

CREATE TABLE coeficientes (
  id       bigserial PRIMARY KEY,
  banco    text    NOT NULL,
  produto  text    NOT NULL CHECK (produto IN ('emprestimo', 'cartao')),
  prazo    text    NOT NULL DEFAULT '',
  calculo  text    NOT NULL CHECK (calculo IN ('coeficiente', 'multiplicador')),
  fator    numeric(14, 6) NOT NULL CHECK (fator > 0),
  ativo    boolean NOT NULL DEFAULT true,
  ordem    integer NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------------ clientes e fila

CREATE TABLE clientes (
  id                 bigserial PRIMARY KEY,
  chave              text        NOT NULL UNIQUE,  -- CPF:..., MAT:... ou NOME:...|base (ver Logica.gs)
  nome               text        NOT NULL DEFAULT '',
  cpf                text        NOT NULL DEFAULT '',
  matricula          text        NOT NULL DEFAULT '',
  telefone           text        NOT NULL DEFAULT '',
  orgao              text        NOT NULL DEFAULT '',
  origem             text        NOT NULL DEFAULT '',
  status             text        NOT NULL DEFAULT 'Pendente'
                     CHECK (status IN ('Pendente', 'Em atendimento', 'Consultado', 'Sem margem', 'Pulado')),
  atendente_id       bigint      REFERENCES usuarios(id) ON DELETE SET NULL,
  margem_emprestimo  numeric(14, 2),
  margem_cartao      numeric(14, 2),
  melhor_emprestimo  text        NOT NULL DEFAULT '',
  melhor_cartao      text        NOT NULL DEFAULT '',
  observacao         text        NOT NULL DEFAULT '',
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz
);
CREATE INDEX clientes_status_idx ON clientes (status, id);
CREATE INDEX clientes_atendente_idx ON clientes (atendente_id) WHERE atendente_id IS NOT NULL;

-- Histórico: cada clique em Consultado / Sem margem / Pular vira uma linha.
CREATE TABLE atendimentos (
  id                 bigserial PRIMARY KEY,
  cliente_id         bigint      NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  usuario_id         bigint      REFERENCES usuarios(id) ON DELETE SET NULL,
  status             text        NOT NULL,
  margem_emprestimo  numeric(14, 2),
  margem_cartao      numeric(14, 2),
  melhor_emprestimo  text        NOT NULL DEFAULT '',
  melhor_cartao      text        NOT NULL DEFAULT '',
  observacao         text        NOT NULL DEFAULT '',
  criado_em          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX atendimentos_criado_idx ON atendimentos (criado_em);
CREATE INDEX atendimentos_cliente_idx ON atendimentos (cliente_id);

CREATE TABLE importacoes (
  id            bigserial PRIMARY KEY,
  base          text        NOT NULL,
  arquivo       text        NOT NULL DEFAULT '',
  linhas_lidas  integer     NOT NULL DEFAULT 0,
  novos         integer     NOT NULL DEFAULT 0,
  completados   integer     NOT NULL DEFAULT 0,
  ignorados     integer     NOT NULL DEFAULT 0,
  usuario_id    bigint      REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     timestamptz NOT NULL DEFAULT now()
);
