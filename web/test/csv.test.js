const test = require('node:test');
const assert = require('node:assert/strict');
const { lerCsv, detectarSeparador } = require('../server/csv');

test('separador: vírgula (Google Sheets), ponto e vírgula (Excel BR), tab; título solto antes', () => {
  assert.equal(detectarSeparador('a,b,c\n1,2,3'), ',');
  assert.equal(detectarSeparador('a;b;c\n1;2,5;3'), ';');
  assert.equal(detectarSeparador('a\tb\n1\t2'), '\t');
  assert.equal(detectarSeparador('TÍTULO\n\nNome;CPF;Tel\nAna;1;2'), ';');
  assert.equal(detectarSeparador('"x;y;z",b\n1,2'), ',');
});

test('aspas, aspas duplicadas, quebra de linha dentro do campo, CRLF, BOM, linhas vazias', () => {
  const v = lerCsv('﻿Nome,Obs\r\n"Silva, Ana","disse ""oi""\nna linha 2"\r\n\r\nBruno,\r\n');
  assert.deepEqual(v, [['Nome', 'Obs'], ['Silva, Ana', 'disse "oi"\nna linha 2'], ['Bruno', '']]);
});
