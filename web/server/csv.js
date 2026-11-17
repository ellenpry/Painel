// Leitor de CSV pequeno e sem dependências.
// Aceita o CSV do Google Sheets (vírgula) e o do Excel em português (ponto e vírgula),
// campos entre aspas com quebras de linha e aspas duplicadas ("").

/**
 * Escolhe o separador que mais aparece (fora de aspas) nas primeiras 20 linhas.
 * Olha várias linhas porque muitas planilhas têm um título solto antes do cabeçalho.
 */
function detectarSeparador(texto) {
  const contagem = { ';': 0, ',': 0, '\t': 0 };
  let aspas = false, linhas = 0;
  for (let i = 0; i < texto.length && linhas < 20; i++) {
    const ch = texto[i];
    if (ch === '"') aspas = !aspas;
    else if (!aspas && ch === '\n') linhas++;
    else if (!aspas && ch in contagem) contagem[ch]++;
  }
  return [';', '\t'].reduce((a, b) => (contagem[b] > contagem[a] ? b : a), ',');
}

function lerCsv(texto, separador) {
  texto = String(texto || '').replace(/^﻿/, '');
  const sep = separador || detectarSeparador(texto);
  const linhas = [];
  let linha = [], campo = '', aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += ch;
    } else if (ch === '"' && campo === '') {
      aspas = true;
    } else if (ch === sep) {
      linha.push(campo); campo = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += ch;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter(l => l.some(v => String(v).trim() !== ''));
}

module.exports = { lerCsv, detectarSeparador };
