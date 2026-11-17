# Handoff: Painel de Atendimento para correspondente bancária

Nov 17, 2026 · @Millena Silva

## Como usar este handoff

Este documento leva o projeto do zero até a V1 no Claude Code: contexto, dores, solução escolhida, especificação e próximos passos. Exporte em Markdown, salve como `HANDOFF.md` na raiz do repositório e peça ao Claude Code para lê-lo antes de qualquer coisa.

Junto dele vão os dois arquivos da primeira versão já escritos: `Codigo.gs` e `Painel.html`. Eles são o ponto de partida, não a versão final.

## Contexto

A usuária é a Aline, correspondente bancária de empréstimo consignado e saque com margem de cartão consignado. O público são servidores públicos do governo e da previdência do Amapá.

Ela trabalha com 6 bancos: Santander, Banco do Brasil, Industrial, NIO, NG e KardBank. Os dados dos clientes (nome, CPF, telefone, matrícula) ficam em planilhas do Google; hoje são 3 ao mesmo tempo.

O projeto nasceu de uma conversa em que ela contou que fica sobrecarregada olhando planilha por planilha. Ela lembrou de um CRM da empresa anterior que mostrava um cliente por vez na tela, e o atendimento só saía da tela quando era finalizado. Esse é o modelo mental que ela quer de volta.

A ideia do projeto é imergir no trabalho dela, encontrar gargalos e construir ou "agentificar" uma solução. Não foi possível fazer entrevista longa com ela, então a V1 é construída sobre o que já se sabe e validada com uso real.

## Processo atual e dores

O fluxo por cliente é inteiramente manual e se repete o dia todo, com troca constante de aba e de sistema.

1. Abre uma das 3 planilhas do Google e pega o CPF ou a matrícula do cliente.
2. Cola no site de consulta de margem e anota a margem disponível.
3. Simula em cada um dos 6 bancos quanto libera, no empréstimo e no saque do cartão.
4. Escolhe a melhor proposta.
5. Se a planilha não tem CPF ou telefone, pesquisa no Lemitti (lemitti.com).
6. Manda a proposta pelo WhatsApp Business.

Dores relatadas por ela:

- Olhar "um por um" na planilha cansa; tem dias em que ela está de saco cheio da planilha.
- Trabalhar 3 planilhas ao mesmo tempo nos dias de pouco retorno deixa tudo desorganizado.
- Ela quer organização no estilo do CRM antigo: um cliente por vez até finalizar.

Gargalos levantados como hipótese, ainda não medidos:

- A simulação em 6 bancos é provavelmente a etapa que mais consome tempo.
- Não existe status por cliente, então dá para consultar a mesma pessoa duas vezes ou esquecer retornos.
- Não há números do dia: clientes consultados, taxa de resposta, banco que mais fecha.

## Proposta de solução e escopo escolhido

A Aline escolheu começar por duas ideias: fila com um cliente por vez e simulação automática dos 6 bancos. Essas duas formam a V1. O resto fica no roadmap, para depois que a V1 estiver em uso.

| Ideia | O que resolve | Versão | Status |
|---|---|---|---|
| 1. Um cliente por vez na tela (fila única) | Planilhas misturadas, "um por um" | V1 | Escolhida pela Aline |
| 2. Simulação automática dos 6 bancos | Simular banco por banco | V1 | Escolhida pela Aline |
| 3. Mensagem pronta no WhatsApp (link wa.me) | Digitar proposta e procurar contato | V2 | Proposta |
| 4. Status e fila de retornos | Clientes esquecidos | V2 | Parcial na V1 (status básico) |
| 5. IA lendo print da margem e sugerindo respostas | Digitação e respostas repetidas | V2 | Proposta |
| 6. Resumo do dia | Falta de números | V2 | Parcial na V1 (contagem) |
| Agente no WhatsApp via API oficial | Qualificação de clientes | V3 | Só se V1 e V2 provarem valor |

A V1 roda no Google Sheets com Apps Script: não tem custo, os dados ficam onde já estão e as planilhas originais são só lidas.

## Especificação da V1

A V1 é uma planilha nova ("Painel de Atendimento") com Apps Script, um menu próprio e um painel lateral. Ela lê as planilhas de clientes e grava tudo só nas próprias abas.

### Menu "Atendimento"

- **Abrir painel**: abre a barra lateral.
- **Atualizar fila**: importa as planilhas de clientes para a aba Fila.
- **Devolver clientes pulados para a fila**: muda Pulado para Pendente.
- **Configuração inicial**: cria as abas Config, Coeficientes e Fila, se não existirem.

### Abas

| Aba | Para que serve | Conteúdo |
|---|---|---|
| Config | Ligar as fontes | Links do site de margem e do Lemitti; tabela de bases com: Usar? (SIM/NÃO), nome, link, aba, títulos das colunas de nome, CPF, matrícula, telefone e órgão |
| Coeficientes | Simular os bancos | Banco, Produto (Empréstimo/Cartão), Prazo, Cálculo (Coeficiente/Multiplicador), Fator, Ativo? |
| Fila | Estado de cada cliente | Chave (oculta), Nome, CPF, Matrícula, Telefone, Órgão, Origem, Status, Margem empréstimo, Margem cartão, Melhor empréstimo, Melhor cartão, Atualizado em, Observação |

### Regras da fila

- Colunas das bases são achadas pelo título, ignorando maiúsculas, acentos e espaços extras.
- Chave de deduplicação: CPF; sem CPF, matrícula; sem os dois, nome + base.
- CPF com menos de 11 dígitos (zeros perdidos) é completado com zeros à esquerda.
- Cliente repetido em outra base não duplica: só completa campos vazios, como o telefone.
- Rodar Atualizar fila de novo nunca apaga status nem margens já gravados.
- CPF, matrícula e telefone ficam em formato texto.
- Status possíveis: Pendente, Em atendimento, Consultado, Sem margem, Pulado.

### Regras da simulação

- Coeficiente: valor liberado = margem ÷ fator.
- Multiplicador: valor liberado = margem × fator (pensado para o saque do cartão).
- Com vários prazos por banco, o painel mostra só o melhor de cada banco, em ordem decrescente, com o primeiro destacado.
- O cálculo roda no navegador enquanto ela digita; a aba Coeficientes é recarregada a cada cliente.
- A entrada aceita formato brasileiro ("R$ 1.234,56") e também "1234.56".

### Fluxo do painel

1. O painel mostra o cliente Em atendimento; se não houver, pega o primeiro Pendente e marca como Em atendimento.
2. Mostra nome, órgão e base, CPF e matrícula com botão Copiar, e um campo de telefone editável.
3. Atalhos para o site de margem e para o Lemitti abrem em nova aba.
4. Ela digita a margem de empréstimo e a de cartão e vê o ranking dos bancos na hora.
5. Botões Consultado, Sem margem ou Pular gravam status, margens, melhores propostas, telefone, observação e data, e carregam o próximo. Ctrl + Enter marca Consultado.
6. No topo aparecem quantos estão na fila e quantos foram feitos hoje.

Gravações usam LockService e conferem a chave da linha antes de escrever, caso a fila tenha sido reordenada.

## Estado atual do código e decisões

A V1 está escrita, com sintaxe verificada e o cálculo testado em Node, mas ainda não rodou numa planilha real.

| Arquivo | Conteúdo |
|---|---|
| `Codigo.gs` | Menu, criação das abas, importação e deduplicação da fila, leitura dos coeficientes, `obterAtual()` e `finalizar()` |
| `Painel.html` | Barra lateral: dados do cliente, botões de copiar, atalhos, campos de margem, ranking dos bancos, botões de status |

Decisões já tomadas:

- Apps Script dentro do Google Sheets, sem servidor e sem custo.
- As planilhas de origem são só lidas; todo estado vive na aba Fila.
- Mapeamento de colunas configurável na aba Config, porque ainda não conhecemos os cabeçalhos reais.
- Simulação por tabela de coeficientes, não por consulta aos portais dos bancos.
- Os coeficientes atuais na aba são fictícios e precisam ser trocados.
- Interface em barra lateral (300 px), com fonte Roboto para combinar com o Sheets.

## Restrições

O que não fazer importa tanto quanto o que fazer: as regras abaixo valem para todas as versões.

- **Sem robôs nos portais.** Nada de automatizar login ou consulta no site de margem, nos portais dos bancos ou no Lemitti. Costuma violar termos de uso e pode bloquear o acesso da Aline.
- **Sem disparo em massa no WhatsApp.** Cada envio passa por um clique dela; disparo automático é o caminho mais rápido para banir o número.
- **LGPD.** As bases têm CPF e telefone de clientes. Os dados ficam no Google Drive dela; nada vai para serviços de terceiros sem ela confirmar que a empresa permite.
- **IA na V2.** Se usar um modelo de IA, enviar só o necessário (margem, texto da resposta) e evitar mandar CPF.
- **Regras do consignado.** Há regras de abordagem comercial (autorregulação dos bancos contra assédio, horários, insistência). Um agente que fale sozinho com cliente na V3 depende de confirmar essas regras.

## Pendências

Estas informações da Aline destravam a V1 de verdade; sem elas o código roda, mas com dados de exemplo.

- [ ] Print só do cabeçalho de cada uma das 3 planilhas, sem dados de clientes
- [ ] Como ela simula hoje em cada banco: tabela de coeficientes ou portal? Se for tabela, um print dela
- [ ] Se algum banco calcula o cartão de outro jeito (ex.: limite × percentual de saque)
- [ ] Link do site de consulta de margem e print da tela de resultado, com dados borrados
- [ ] Um exemplo da mensagem que ela manda aos clientes (para a V2)

Perguntas abertas:

- As 3 planilhas estão no mesmo arquivo ou em arquivos diferentes? O código aceita os dois casos.
- A conta Google da Aline tem acesso de leitura a todas as bases?
- Ela prefere a barra lateral (300 px) ou uma janela maior?

## Plano no Claude Code

O caminho recomendado é versionar o projeto num repositório e publicar no Google com o clasp, a ferramenta oficial de linha de comando do Apps Script.

1. Criar o repositório com `HANDOFF.md`, `src/Codigo.gs` e `src/Painel.html`.
2. Instalar e logar o clasp: `npm i -g @google/clasp` e `clasp login`. Ativar a API do Apps Script em script.google.com › Configurações.
3. Criar a planilha vinculada com `clasp create --type sheets --title "Painel de Atendimento" --rootDir src`.
4. Pedir ao Claude Code para separar a lógica pura (conversão de números, CPF, deduplicação, simulação) num módulo testável em Node e escrever testes.
5. Rodar `clasp push`, abrir a planilha e testar com uma base de exemplo com dados fictícios.
6. Quando chegarem as pendências, ajustar o mapeamento de colunas e o cálculo do cartão.
7. Instalar na conta da Aline e acompanhar uma semana de uso antes de começar a V2.

Prompt inicial sugerido:

```
Leia o HANDOFF.md inteiro antes de começar.

Estamos construindo a V1 do Painel de Atendimento (Google Sheets + Apps
Script) para uma correspondente bancária. O código inicial está em
src/Codigo.gs e src/Painel.html.

Tarefas:
1. Revise o código contra a seção "Especificação da V1" e liste divergências
ou bugs antes de mudar qualquer coisa.
2. Configure o clasp para este projeto (rootDir src).
3. Extraia a lógica pura (numero_, formatarCpf_, normalizar_, chave de
deduplicação, simulação) para funções testáveis e crie testes em Node
cobrindo formato brasileiro, CPF sem zeros, clientes repetidos e vários
prazos por banco.
4. Crie uma planilha de teste com dados fictícios para validar Atualizar fila
e o painel.

Respeite a seção "Restrições": nada de automação em portais, nada de disparo
em massa, nenhum dado de cliente fora do Google Drive.
```
