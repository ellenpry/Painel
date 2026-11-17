// Login, esqueci minha senha, redefinir senha e aceitar convite.
(function () {
  const { api, mostrarAlerta, ocupado, parametro } = window.Painel;
  const pagina = document.body.dataset.pagina;
  const form = document.getElementById('form');
  const alerta = document.getElementById('alerta');
  const $ = id => document.getElementById(id);

  function conferirSenhas() {
    if ($('senha').value.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
    if ($('senha').value !== $('confirmacao').value) return 'As duas senhas não são iguais.';
    return null;
  }

  function aoEnviar(fn) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      mostrarAlerta(alerta, '');
      const botao = form.querySelector('button[type=submit]');
      try { await ocupado(botao, fn); } catch (err) { mostrarAlerta(alerta, err.message, 'erro'); }
    });
  }

  if (pagina === 'login') {
    if (parametro('saiu')) mostrarAlerta(alerta, 'Você saiu da sua conta.', 'ok');
    aoEnviar(async () => {
      if (!$('email').value.trim() || !$('senha').value) throw new Error('Preencha e-mail e senha.');
      await api('POST', '/auth/login', { email: $('email').value, senha: $('senha').value });
      location.href = '/app';
    });
  }

  if (pagina === 'esqueci') {
    aoEnviar(async () => {
      const r = await api('POST', '/auth/esqueci-senha', { email: $('email').value });
      mostrarAlerta(alerta, r.mensagem + ' Confira também a caixa de spam.', 'ok');
      form.hidden = true;
    });
  }

  if (pagina === 'redefinir' || pagina === 'convite') {
    const token = parametro('token') || '';
    const ehConvite = pagina === 'convite';
    const sub = $('sub');
    const rota = ehConvite ? '/auth/convites/' : '/auth/redefinir-senha/';
    api('GET', rota + encodeURIComponent(token)).then(r => {
      $('email').value = r.email;
      sub.textContent = ehConvite
        ? 'Você foi convidado(a) como ' + (r.papel === 'admin' ? 'administrador(a)' : 'atendente') + '. Crie sua senha para entrar.'
        : 'Conta: ' + r.email;
      form.hidden = false;
      (ehConvite ? $('nome') : $('senha')).focus();
    }).catch(err => {
      sub.textContent = '';
      mostrarAlerta(alerta, err.message, 'erro');
    });

    aoEnviar(async () => {
      if (ehConvite && $('nome').value.trim().length < 2) throw new Error('Informe seu nome.');
      const problema = conferirSenhas();
      if (problema) throw new Error(problema);
      if (ehConvite) await api('POST', '/auth/convites/aceitar', { token, nome: $('nome').value, senha: $('senha').value });
      else await api('POST', '/auth/redefinir-senha', { token, senha: $('senha').value });
      location.href = '/app';
    });
  }
})();
