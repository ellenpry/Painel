// Utilidades compartilhadas por todas as páginas.
(function () {
  async function api(metodo, caminho, corpo) {
    const r = await fetch('/api' + caminho, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'painel' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      credentials: 'same-origin'
    });
    let dados = null;
    try { dados = await r.json(); } catch (e) { /* sem corpo */ }
    if (!r.ok) {
      const erro = new Error((dados && dados.erro) || 'Não foi possível concluir. Tente de novo.');
      erro.status = r.status;
      throw erro;
    }
    return dados;
  }

  function el(tag, attrs, ...filhos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) if (f != null && f !== false) e.append(f instanceof Node ? f : String(f));
    return e;
  }

  function mostrarAlerta(alvo, texto, tipo) {
    alvo.textContent = texto || '';
    alvo.className = 'alerta ' + (tipo || 'erro');
    alvo.hidden = !texto;
  }

  let timerToast;
  function toast(texto, tipo) {
    let t = document.querySelector('.aviso-toast');
    if (!t) { t = el('div', { class: 'aviso-toast', role: 'status' }); document.body.append(t); }
    t.textContent = texto;
    t.className = 'aviso-toast ' + (tipo || '');
    t.hidden = false;
    clearTimeout(timerToast);
    timerToast = setTimeout(() => { t.hidden = true; }, tipo === 'erro' ? 6000 : 2500);
  }

  /** Desabilita o botão enquanto a ação roda. */
  async function ocupado(botao, fn) {
    const texto = botao.textContent;
    botao.disabled = true;
    try { return await fn(); } finally { botao.disabled = false; botao.textContent = texto; }
  }

  function formatarData(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); return true; } catch (e) {
      const t = el('textarea', {}, texto);
      t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.append(t); t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      t.remove();
      return ok;
    }
  }

  function parametro(nome) { return new URLSearchParams(location.search).get(nome); }

  window.Painel = { api, el, mostrarAlerta, toast, ocupado, formatarData, copiar, parametro };
})();
