// Simulação mínima, em memória, dos serviços do Apps Script usados pelo Codigo.gs.
// Não substitui o teste numa planilha real; serve para pegar erros de fluxo e de índice.
// Imita um comportamento importante do Sheets: texto que parece número vira número,
// a não ser que a célula esteja com formato de texto ("@").
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function letrasParaColuna(l) {
  let n = 0;
  for (const ch of l) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseA1(a1) {
  const [ini, fim] = a1.split(':');
  const p = s => { const m = /^([A-Z]+)(\d+)$/.exec(s); return { c: letrasParaColuna(m[1]), r: Number(m[2]) }; };
  const a = p(ini), b = fim ? p(fim) : a;
  return [a.r, a.c, b.r - a.r + 1, b.c - a.c + 1];
}

/** Objeto que aceita qualquer método encadeado (setFontWeight, setBackground...) sem fazer nada. */
function encadeavel(base) {
  return new Proxy(base, {
    get(alvo, prop) {
      if (prop in alvo) return alvo[prop];
      if (typeof prop === 'symbol') return undefined;
      return () => encadeavelProxy(alvo);
    }
  });
}
const proxies = new WeakMap();
function encadeavelProxy(alvo) {
  if (!proxies.has(alvo)) proxies.set(alvo, encadeavel(alvo));
  return proxies.get(alvo);
}

class Aba {
  constructor(nome) { this.nome = nome; this.celulas = []; this.formatos = {}; this.ocultas = []; }
  getName() { return this.nome; }
  valor(r, c) { return (this.celulas[r - 1] || [])[c - 1] ?? ''; }
  gravar(r, c, v) {
    if (typeof v === 'string' && this.formatos[r + ',' + c] !== '@' && /^-?\d+(\.\d+)?$/.test(v.trim())) v = Number(v);
    while (this.celulas.length < r) this.celulas.push([]);
    this.celulas[r - 1][c - 1] = v;
  }
  getLastRow() {
    for (let i = this.celulas.length; i > 0; i--) if ((this.celulas[i - 1] || []).some(v => v !== '' && v != null)) return i;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.celulas.map(l => l.length)); }
  getMaxRows() { return 1000; }
  getRange(a, b, c, d) {
    const [r, col, nr, nc] = typeof a === 'string' ? parseA1(a) : [a, b, c || 1, d || 1];
    return encadeavelProxy(new Faixa(this, r, col, nr, nc));
  }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  clear() { this.celulas = []; this.formatos = {}; return this; }
  hideColumns(c) { this.ocultas.push(c); }
  setFrozenRows() {}
  setColumnWidth() {}
}

class Faixa {
  constructor(aba, r, c, nr, nc) { Object.assign(this, { aba, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) { const l = []; for (let j = 0; j < this.nc; j++) l.push(this.aba.valor(this.r + i, this.c + j)); out.push(l); }
    return out;
  }
  getDisplayValues() { return this.getValues().map(l => l.map(v => (v instanceof Date ? v.toISOString() : String(v)))); }
  getValue() { return this.aba.valor(this.r, this.c); }
  setValue(v) { return this.setValues(Array.from({ length: this.nr }, () => Array(this.nc).fill(v))); }
  setValues(m) {
    if (m.length !== this.nr || m.some(l => l.length !== this.nc)) {
      throw new Error(`setValues: dimensões ${m.length}x${m[0] && m[0].length} ≠ faixa ${this.nr}x${this.nc}`);
    }
    m.forEach((l, i) => l.forEach((v, j) => this.aba.gravar(this.r + i, this.c + j, v)));
    return encadeavelProxy(this);
  }
  setNumberFormat(f) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.aba.formatos[(this.r + i) + ',' + (this.c + j)] = f;
    return encadeavelProxy(this);
  }
}

class Planilha {
  constructor() { this.abas = []; }
  getSheetByName(n) { return this.abas.find(a => a.nome === n) || null; }
  insertSheet(n) {
    if (this.getSheetByName(n)) throw new Error('Já existe aba ' + n);
    const a = new Aba(n); this.abas.push(a); return encadeavelProxy(a);
  }
  getSheets() { return this.abas; }
  getSpreadsheetTimeZone() { return 'America/Belem'; }
}

/** Carrega Logica.gs + Codigo.gs num contexto com os serviços simulados. */
function carregarProjeto() {
  const planilha = new Planilha();
  const alertas = [];
  const travas = { ativa: false, maxAninhada: 0 };
  const ui = {
    alert: (...args) => { alertas.push(args.length > 1 ? args[0] + '\n' + args[1] : args[0]); },
    ButtonSet: { OK: 'OK' },
    createMenu: () => encadeavelProxy({}),
    showSidebar: () => {}
  };
  const ctx = vm.createContext({
    console,
    SpreadsheetApp: {
      getActive: () => planilha,
      getUi: () => ui,
      flush: () => {},
      newDataValidation: () => encadeavelProxy({ build: () => ({}) }),
      openByUrl: () => { throw new Error('openByUrl não simulado'); },
      openById: () => { throw new Error('openById não simulado'); }
    },
    LockService: {
      getDocumentLock: () => ({
        waitLock: () => { if (travas.ativa) throw new Error('lock aninhado'); travas.ativa = true; },
        releaseLock: () => { travas.ativa = false; }
      })
    },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        if (fmt !== 'yyyy-MM-dd') throw new Error('formato não simulado: ' + fmt);
        const local = new Date(d.getTime() - 3 * 3600 * 1000); // America/Belem = UTC-3
        return local.toISOString().slice(0, 10);
      }
    },
    HtmlService: {}
  });
  for (const arq of ['Logica.gs', 'Codigo.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', arq), 'utf8'), ctx, { filename: arq });
  }
  return { ctx, planilha, alertas, travas };
}

module.exports = { carregarProjeto };
