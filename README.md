# Painel de Atendimento

Planilha Google com Apps Script que mostra **um cliente por vez** e **simula os 6 bancos na hora**, para a rotina de uma correspondente bancária de consignado. Contexto completo, especificação e restrições estão em [`HANDOFF.md`](HANDOFF.md). Leia esse arquivo antes de mexer no código.

## Estrutura

| Arquivo | O que tem |
|---|---|
| `src/Logica.gs` | Lógica pura, sem serviços do Google: números em formato brasileiro, CPF, deduplicação da fila, leitura dos coeficientes, simulação. Roda no Apps Script, no navegador (o painel recebe o mesmo código) e no Node (testes). |
| `src/Codigo.gs` | Menu **Atendimento**, criação das abas, importação das bases (Atualizar fila), `obterAtual()`, `finalizar()`, bases de exemplo fictícias. |
| `src/Painel.html` | Barra lateral de 300 px com os dados do cliente, botões de copiar, atalhos, margens, ranking dos bancos e botões de status. |
| `src/appsscript.json` | Manifesto: runtime V8, fuso `America/Belem` (Amapá). |
| `test/` | `logica.test.js` (lógica pura) e `planilha.test.js` (fluxo completo do `Codigo.gs` numa planilha simulada em memória). |
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
