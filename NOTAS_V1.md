# Notas da V1

## Origem do código

O handoff cita `Codigo.gs` e `Painel.html` já escritos, mas esses arquivos **não vieram junto com o PDF**. Por isso a V1 deste repositório foi escrita do zero, seguindo a seção "Especificação da V1" do `HANDOFF.md`. A tarefa 1 do prompt sugerido ("revise o código e liste divergências") ficou assim:

- Não foi possível revisar os arquivos originais. Se eles aparecerem, vale compará-los com `src/` antes de escolher uma base.
- Abaixo estão os pontos em que a especificação deixava margem e a decisão tomada em cada um.

## Decisões em pontos que a especificação não fechava

| Ponto | Decisão |
|---|---|
| Painel e servidor calculando igual | A lógica fica em `src/Logica.gs`. O painel recebe o código-fonte dessas funções (`codigoLogicaParaPainel_`), então o ranking na tela e o "Melhor empréstimo/cartão" gravado na planilha vêm da mesma fonte. O servidor recalcula ao gravar e não confia no valor do navegador. |
| "1.234" sem vírgula | Tratado como mil duzentos e trinta e quatro (milhar brasileiro). Com um ponto seguido de 1, 2 ou 4+ dígitos ("1234.5"), o ponto é decimal. "1,234.56" também é aceito. |
| Matrícula na chave | Comparada sem pontuação e sem zeros à esquerda ("00.123-4" = "1234"). |
| CPF com mais de 11 dígitos | Mantido como veio, para ela conferir. CPF só com zeros conta como vazio. |
| Cliente em duas bases | Fica com a origem da primeira base lida. A segunda só completa campos vazios. |
| Linha de títulos da base | Procurada nas 10 primeiras linhas (muitas planilhas têm um título antes do cabeçalho). |
| Título de coluna vazio na Config | Tenta nomes comuns (ex.: telefone → Telefone, Celular, Fone, WhatsApp). |
| "Ativo?" vazio | Conta como SIM. Só NÃO/N/FALSE/0 desliga a linha. |
| "Feitos hoje" | Consultado + Sem margem com data de hoje. Pulado não conta. |
| "Na fila" | Pendente + Em atendimento. |
| Telefone | Guardado como texto, do jeito que veio (sem tirar a formatação), porque pode haver dois números na mesma célula. |
| Bases de exemplo | Item extra no menu, só com dados fictícios, para cumprir a tarefa 4 sem usar dados reais. |

## Testado

- `npm test`: 20 testes. Cobrem formato brasileiro, CPF sem zeros, clientes repetidos, vários prazos por banco, banco inativo, fila reordenada antes de gravar e "Atualizar fila" rodando de novo sem apagar nada.
- `test/planilha.test.js` roda o `Codigo.gs` inteiro contra uma planilha simulada em memória. A simulação imita o Sheets transformando texto numérico em número, exceto em células com formato texto.
- O `Painel.html` foi renderizado no Chromium com o servidor simulado: ranking ao digitar, Ctrl + Enter, próximo cliente e aviso de margem inválida funcionaram.

## Ainda não testado (precisa de planilha real)

- `clasp push` e autorização na conta Google.
- Leitura de bases em **outros arquivos** (`openByUrl`/`openById`). A simulação só cobre abas do mesmo arquivo.
- Botão Copiar dentro do iframe do Apps Script. Usa `navigator.clipboard` e, se falhar, `execCommand('copy')`.
- Desempenho com bases grandes. "Atualizar fila" regrava a aba Fila inteira; deve servir até alguns milhares de linhas.
