// Aplica o tema escolhido em "Minha conta" antes de a página aparecer (evita piscar).
// Sem escolha salva, o tema segue o sistema (CSS prefers-color-scheme).
(function () {
  try {
    var t = localStorage.getItem('libera-tema');
    if (t === 'claro' || t === 'escuro') document.documentElement.setAttribute('data-tema', t);
  } catch (e) { /* armazenamento bloqueado: segue o sistema */ }
})();
