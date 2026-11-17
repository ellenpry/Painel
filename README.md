# Painel de Atendimento

O projeto tem duas formas de uso, que compartilham a mesma lógica de cálculo (`src/Logica.gs`):

- **Plataforma web** (`web/`): login próprio só por convite, recuperação de senha por e-mail, banco PostgreSQL, tudo em Docker. Veja [Plataforma web](#plataforma-web).
- **Planilha Google + Apps Script** (`src/`): a V1 original do handoff, sem servidor.

---

## Plataforma web

### Subir no seu computador

Precisa só do Docker.

```bash
cp .env.example .env
```

Edite o `.env` e defina `ADMIN_EMAIL` e `ADMIN_SENHA` (mínimo de 8 caracteres). Esse é o primeiro administrador, criado só quando o banco está vazio. Depois:

```bash
docker compose up -d --build
```

| Endereço | O que é |
|---|---|
| <http://localhost:3000> | A plataforma |
| <http://localhost:8025> | Mailpit: caixa de e-mail de teste. Os convites e as redefinições de senha aparecem aqui; nada sai para a internet. |

Para parar: `docker compose down`. Os dados continuam no volume `dados_postgres`. Para apagar tudo: `docker compose down -v`.

### Acesso

- **Não existe cadastro aberto.** Um administrador convida pelo e-mail em **Usuários**. A pessoa recebe um link (válido por 7 dias, de uso único) para criar nome e senha. O link também aparece na tela para ser enviado pelo WhatsApp se o e-mail falhar.
- **Esqueci minha senha**: envia um link válido por 60 minutos, de uso único. Ao trocar a senha, todas as outras sessões da pessoa são encerradas. A resposta é a mesma exista ou não a conta, para não revelar quem está cadastrado.
- Papéis: **administrador** (tudo) e **atendente** (atendimento, fila, importação e consulta dos coeficientes).
- Convite pela linha de comando, se precisar: `docker compose exec web npm run convite -- pessoa@exemplo.com admin`.

### Telas

- **Atendimento**: um cliente por vez. Cada pessoa tem o seu cliente "Em atendimento"; duas pessoas nunca pegam o mesmo. O ranking dos bancos aparece enquanto se digita a margem. Consultado, Sem margem ou Pular gravam e trazem o próximo; Ctrl + Enter marca Consultado.
- **Fila**: busca por nome, CPF, matrícula, telefone, órgão ou base, filtro por status, histórico de cada cliente, "Devolver pulados".
- **Importar base**: envia o CSV exportado do Google Sheets (ou do Excel). As colunas são encontradas pelo título, com prévia antes de importar. Usa as mesmas regras de deduplicação da planilha.
- **Coeficientes**, **Configurações** (links do site de margem e do Lemitti) e **Usuários** (convites, papéis, desativar acesso).

### Banco de dados

PostgreSQL 16. O esquema fica em `web/server/migrations/` e é aplicado sozinho quando o container sobe.

| Tabela | Conteúdo |
|---|---|
| `usuarios` | Nome, e-mail, hash da senha (scrypt), papel, ativo |
| `convites`, `redefinicoes_senha` | Só o hash SHA-256 do token, com validade e marca de uso |
| `sessoes` | Sessões de login (cookie HttpOnly), com hash do token |
| `clientes` | A fila: cadastro, status, quem está atendendo, margens, melhores propostas |
| `atendimentos` | Histórico de cada Consultado / Sem margem / Pular, com quem fez e quando |
| `coeficientes`, `configuracoes`, `importacoes` | Tabela de simulação, links e registro das importações |

### Testes da plataforma

Os testes da API precisam de um PostgreSQL descartável (o esquema é apagado):

```bash
docker run -d --name painel-teste-db -e POSTGRES_PASSWORD=teste -p 127.0.0.1:5433:5432 postgres:16-alpine
```

```bash
cd web && npm install && TEST_DATABASE_URL=postgres://postgres:teste@localhost:5433/postgres npm test
```

### Antes de usar com clientes reais

- **LGPD**: na plataforma web, CPF e telefone saem do Google Drive e passam a ficar no banco de onde ela estiver hospedada. Isso muda uma decisão do `HANDOFF.md`. Confirme com a empresa antes de importar dados reais e escolha onde hospedar.
- Em produção: HTTPS na frente, `COOKIE_SECURE=true`, `APP_URL` com o endereço público, SMTP real no lugar do Mailpit, senha forte em `POSTGRES_PASSWORD` e backup do volume do banco.
- Os coeficientes iniciais são **fictícios**.

---

## Planilha Google (Apps Script)

Planilha Google com Apps Script que mostra **um cliente por vez** e **simula os 6 bancos na hora**, para a rotina de uma correspondente bancária de consignado. Contexto completo, especificação e restrições estão em [`HANDOFF.md`](HANDOFF.md). Leia esse arquivo antes de mexer no código.

## Estrutura

| Arquivo | O que tem |
|---|---|
| `src/Logica.gs` | Lógica pura, sem serviços do Google: números em formato brasileiro, CPF, deduplicação da fila, leitura dos coeficientes, simulação. Roda no Apps Script, no navegador (o painel recebe o mesmo código) e no Node (testes). |
| `src/Codigo.gs` | Menu **Atendimento**, criação das abas, importação das bases (Atualizar fila), `obterAtual()`, `finalizar()`, bases de exemplo fictícias. |
| `src/Painel.html` | Barra lateral de 300 px com os dados do cliente, botões de copiar, atalhos, margens, ranking dos bancos e botões de status. |
| `src/appsscript.json` | Manifesto: runtime V8, fuso `America/Belem` (Amapá). |
| `test/` | `logica.test.js` (lógica pura) e `planilha.test.js` (fluxo completo do `Codigo.gs` numa planilha simulada em memória). |
| `web/` | Plataforma web (servidor Express, páginas, migrações do banco, testes). |
| `NOTAS_V1.md` | Revisão contra a especificação, decisões de implementação e o que ainda falta testar. |

## Testes

```bash
npm test
```

Não precisa instalar nada além do Node 18 ou mais novo.

## Publicar no Google (clasp)

1. Instale o clasp e faça login com a conta Google em que a planilha vai ficar:

   ```bash
   npm i -g @google/clasp
   ```

   ```bash
   clasp login
   ```

2. Ative a **Google Apps Script API** em <https://script.google.com/home/usersettings>.
3. Crie a planilha vinculada (isso gera o `.clasp.json`, que fica fora do git porque cada conta tem o seu):

   ```bash
   clasp create --type sheets --title "Painel de Atendimento" --rootDir src
   ```

   Se o clasp sobrescrever `src/appsscript.json`, restaure a versão do repositório:

   ```bash
   git checkout src/appsscript.json
   ```

   Para usar uma planilha que já existe, copie `.clasp.json.exemplo` para `.clasp.json` e cole o ID do script (Extensões › Apps Script › Configurações do projeto).

4. Envie o código:

   ```bash
   clasp push
   ```

5. Abra a planilha, recarregue a página e use o menu **Atendimento**:
   1. **Configuração inicial**: cria as abas Config, Coeficientes e Fila.
   2. **Criar bases de exemplo (dados fictícios)**: cria duas abas de teste e as liga na Config.
   3. **Atualizar fila**: deve informar 7 clientes lidos e 6 novos na fila.
   4. **Abrir painel**: na primeira vez o Google pede autorização.

## Usar com as bases reais

- Na aba **Config**, cole o link do site de margem e, para cada base, preencha `Usar? = SIM`, nome, link da planilha (vazio = aba deste mesmo arquivo), nome da aba e os títulos das colunas. Os títulos podem ficar vazios; nesse caso o painel tenta os nomes mais comuns.
- Na aba **Coeficientes**, troque os valores **fictícios** pelos reais. Coeficiente: liberado = margem ÷ fator. Multiplicador: liberado = margem × fator.
- As planilhas de origem são só lidas. Todo o estado fica na aba **Fila**.

## Restrições (valem para todas as versões)

Nada de robôs no site de margem, nos portais dos bancos ou no Lemitti. Nada de disparo em massa no WhatsApp. Nenhum dado de cliente sai do Google Drive. Detalhes em [`HANDOFF.md`](HANDOFF.md#restrições).
