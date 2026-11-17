// Aplicação principal. Rotas por hash: #/atendimento, #/fila, #/importar, ...
// numero_, simular_, formatarMoeda_, mostrarCpf_ vêm de /js/logica.js (mesmo código da planilha e do servidor).
(function () {
  const { api, el, mostrarAlerta, toast, ocupado, formatarData, copiar } = window.Painel;
  const conteudo = document.getElementById('conteudo');
  const STATUS = ['Pendente', 'Em atendimento', 'Consultado', 'Sem margem', 'Pulado'];
  let eu = null;
  let limpezaDaTela = null; // remove listeners globais da tela anterior

  function ehAdmin() { return eu && eu.papel === 'admin'; }
  function moeda(v) { return v == null || v === '' ? '' : formatarMoeda_(v); }
  function etiqueta(status) { return el('span', { class: 'etiqueta ' + String(status).replace(/\s+/g, '-') }, status); }
  function cabecalho(titulo, ...extras) {
    return el('div', { class: 'cabecalho-pagina' }, el('h1', {}, titulo), el('div', { class: 'linha-botoes' }, ...extras));
  }
  function tratarErro(e) {
    if (e.status === 401) { location.href = '/login'; return; }
    toast(e.message, 'erro');
  }

  // ================================================================ atendimento

  async function telaAtendimento() {
    const estado = { cliente: null, coeficientes: [], ocupado: false };
    const indicadores = el('div', { class: 'indicadores' });
    const aviso = el('div', { hidden: true });
    const area = el('div', {}, el('p', { class: 'mudo' }, 'Carregando…'));
    conteudo.replaceChildren(cabecalho('Atendimento', indicadores), aviso, area);

    function desenharIndicadores(r) {
      indicadores.replaceChildren(
        el('div', { class: 'indicador' }, el('b', {}, r.naFila), el('span', {}, 'na fila')),
        el('div', { class: 'indicador' }, el('b', {}, r.meusHoje), el('span', {}, 'feitos por você hoje')),
        el('div', { class: 'indicador' }, el('b', {}, r.feitosHoje), el('span', {}, 'feitos pela equipe hoje'))
      );
    }

    function linhaRanking(lista, ol, texto) {
      ol.replaceChildren();
      const vazio = t => ol.append(el('li', { class: 'vazio' }, t));
      if (!texto) return vazio('Digite a margem para ver os bancos');
      if (numero_(texto) == null) return vazio('Valor não reconhecido');
      if (!lista.length) return vazio(numero_(texto) > 0 ? 'Nenhum banco ativo para este produto' : 'Sem valor a simular');
      lista.forEach((item, i) => {
        const prazo = item.prazo ? (/^\d+$/.test(String(item.prazo)) ? item.prazo + 'x' : item.prazo) : '';
        ol.append(el('li', { class: i === 0 ? 'melhor' : '' },
          el('span', {}, item.banco, prazo ? el('span', { class: 'prazo' }, prazo) : null),
          el('span', { class: 'valor' }, formatarMoeda_(item.valor))));
      });
    }

    function desenhar(r) {
      estado.cliente = r.cliente;
      estado.coeficientes = r.coeficientes;
      desenharIndicadores(r.resumo);
      if (r.coeficientesFicticios) {
        mostrarAlerta(aviso, 'Os coeficientes ainda são de exemplo (fictícios). ' +
          (ehAdmin() ? 'Troque pelos reais em Coeficientes.' : 'Peça para um administrador cadastrar os reais.'), 'aviso');
      } else aviso.hidden = true;

      const c = r.cliente;
      if (!c) {
        area.replaceChildren(el('div', { class: 'painel fila-vazia' },
          el('div', { class: 'grande' }, 'Nenhum cliente pendente na fila'),
          el('p', { class: 'mudo' }, 'Importe uma base nova ou devolva os clientes pulados para a fila.'),
          el('div', { class: 'linha-botoes' },
            el('a', { class: 'botao primario', href: '#/importar' }, 'Importar base'),
            el('button', { onclick: async e => {
              await ocupado(e.target, async () => {
                const x = await api('POST', '/clientes/devolver-pulados');
                toast(x.devolvidos ? `${x.devolvidos} cliente(s) voltaram para a fila.` : 'Não há clientes pulados.');
                if (x.devolvidos) carregar();
              }).catch(tratarErro);
            } }, 'Devolver pulados'))));
        area.querySelector('.linha-botoes').style.justifyContent = 'center';
        return;
      }

      const margemEmp = el('input', { id: 'margemEmp', inputmode: 'decimal', placeholder: 'R$ 0,00', autocomplete: 'off',
        value: c.margemEmprestimo != null ? formatarMoeda_(c.margemEmprestimo) : '' });
      const margemCartao = el('input', { id: 'margemCartao', inputmode: 'decimal', placeholder: 'R$ 0,00', autocomplete: 'off',
        value: c.margemCartao != null ? formatarMoeda_(c.margemCartao) : '' });
      const telefone = el('input', { id: 'telefone', autocomplete: 'off', value: c.telefone });
      const obs = el('textarea', { id: 'obs', rows: 3 }, c.observacao);
      const rankEmp = el('ol', { class: 'ranking' });
      const rankCartao = el('ol', { class: 'ranking' });

      function recalcular() {
        const sim = simular_(estado.coeficientes, margemEmp.value.trim(), margemCartao.value.trim());
        linhaRanking(sim.emprestimo, rankEmp, margemEmp.value.trim());
        linhaRanking(sim.cartao, rankCartao, margemCartao.value.trim());
      }
      margemEmp.addEventListener('input', recalcular);
      margemCartao.addEventListener('input', recalcular);

      function dado(rotulo, valorExibido, valorCopiar) {
        return el('div', { class: 'dado' }, el('span', { class: 'rot' }, rotulo), el('span', { class: 'val' }, valorExibido || '—'),
          el('button', { disabled: !valorCopiar, onclick: async e => {
            const ok = await copiar(valorCopiar);
            e.target.textContent = ok ? 'Copiado!' : 'Erro';
            setTimeout(() => { e.target.textContent = 'Copiar'; }, 1200);
          } }, 'Copiar'));
      }
      function atalho(texto, url) {
        return url ? el('a', { class: 'botao', href: url, target: '_blank', rel: 'noopener noreferrer' }, texto + ' ↗')
          : el('span', { class: 'botao desligado', title: 'Configure o link em Configurações' }, texto);
      }

      const botoes = ['Consultado', 'Sem margem', 'Pulado'].map(st =>
        el('button', { class: st === 'Consultado' ? 'primario' : '', onclick: () => finalizar(st) }, st === 'Pulado' ? 'Pular' : st));

      area.replaceChildren(el('div', { class: 'atendimento' },
        el('section', { class: 'painel' },
          el('div', { class: 'cliente-nome' }, c.nome || '(sem nome)'),
          el('div', { class: 'cliente-sub' }, [c.orgao, c.origem].filter(Boolean).join(' · ')),
          dado('CPF', c.cpf ? mostrarCpf_(c.cpf) : '', c.cpf),
          dado('Matrícula', c.matricula, c.matricula),
          el('label', { for: 'telefone' }, 'Telefone'), telefone,
          el('div', { class: 'atalhos' }, atalho('Site de margem', r.links.margem), atalho('Lemitti', r.links.lemitti)),
          el('div', { class: 'margens' },
            el('div', {}, el('label', { for: 'margemEmp' }, 'Margem empréstimo'), margemEmp),
            el('div', {}, el('label', { for: 'margemCartao' }, 'Margem cartão'), margemCartao)),
          el('label', { for: 'obs' }, 'Observação'), obs,
          el('div', { class: 'acoes' }, ...botoes),
          el('div', { class: 'dica' }, 'Ctrl + Enter marca Consultado')),
        el('section', { class: 'painel' },
          el('h3', {}, 'Empréstimo'), rankEmp,
          el('h3', {}, 'Saque do cartão'), rankCartao,
          el('p', { class: 'mudo pequeno' }, 'Melhor prazo de cada banco, do maior para o menor valor liberado.'))));
      recalcular();
      margemEmp.focus();

      async function finalizar(status) {
        if (estado.ocupado) return;
        estado.ocupado = true;
        botoes.forEach(b => { b.disabled = true; });
        try {
          const r2 = await api('POST', '/atendimento/finalizar', {
            id: c.id, chave: c.chave, status,
            margemEmprestimo: margemEmp.value, margemCartao: margemCartao.value,
            telefone: telefone.value, observacao: obs.value
          });
          toast(`${c.nome}: ${status === 'Pulado' ? 'pulado' : status} ✓`);
          desenhar(r2);
        } catch (e) {
          tratarErro(e);
          if (e.status === 409) carregar();
        } finally {
          estado.ocupado = false;
          botoes.forEach(b => { b.disabled = false; });
        }
      }
      estado.finalizar = finalizar;
    }

    async function carregar() {
      try { desenhar(await api('GET', '/atendimento/atual')); } catch (e) { tratarErro(e); }
    }

    const atalhoTeclado = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && estado.cliente && estado.finalizar) {
        e.preventDefault();
        estado.finalizar('Consultado');
      }
    };
    document.addEventListener('keydown', atalhoTeclado);
    limpezaDaTela = () => document.removeEventListener('keydown', atalhoTeclado);
    await carregar();
  }

  // ================================================================ fila

  async function telaFila() {
    const filtro = { busca: '', status: '', pagina: 1 };
    const busca = el('input', { type: 'search', placeholder: 'Buscar por nome, CPF, matrícula, telefone, órgão ou base' });
    const status = el('select', {}, el('option', { value: '' }, 'Todos os status'), STATUS.map(s => el('option', { value: s }, s)));
    const contagem = el('div', { class: 'linha-botoes' });
    const corpo = el('tbody');
    const paginacao = el('div', { class: 'paginacao' });
    const acoes = [el('button', { onclick: async e => {
      await ocupado(e.target, async () => {
        const r = await api('POST', '/clientes/devolver-pulados');
        toast(r.devolvidos ? `${r.devolvidos} cliente(s) voltaram para a fila.` : 'Não há clientes pulados.');
        carregar();
      }).catch(tratarErro);
    } }, 'Devolver pulados para a fila')];
    if (ehAdmin()) {
      acoes.push(el('button', { title: 'Para clientes presos com alguém que fechou a tela', onclick: async e => {
        if (!confirm('Devolver para a fila TODOS os clientes que estão "Em atendimento" (inclusive com outras pessoas)?')) return;
        await ocupado(e.target, async () => {
          const r = await api('POST', '/clientes/liberar-em-atendimento');
          toast(`${r.liberados} cliente(s) liberados.`);
          carregar();
        }).catch(tratarErro);
      } }, 'Liberar "Em atendimento"'));
    }

    conteudo.replaceChildren(
      cabecalho('Fila de clientes', ...acoes),
      el('div', { class: 'painel' },
        contagem,
        el('div', { class: 'filtros' }, busca, status),
        el('div', { class: 'tabela-rolagem' }, el('table', {},
          el('thead', {}, el('tr', {}, ['Nome', 'CPF', 'Matrícula', 'Telefone', 'Órgão · Base', 'Status', 'Margem emp.', 'Melhor empréstimo', 'Melhor cartão', 'Atualizado'].map(t => el('th', {}, t)))),
          corpo)),
        paginacao));

    let timer;
    busca.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { filtro.busca = busca.value; filtro.pagina = 1; carregar(); }, 250); });
    status.addEventListener('change', () => { filtro.status = status.value; filtro.pagina = 1; carregar(); });

    async function verHistorico(c) {
      const r = await api('GET', `/clientes/${c.id}/historico`);
      const d = el('dialog', {},
        el('h2', {}, c.nome),
        el('p', { class: 'mudo' }, [c.cpf && mostrarCpf_(c.cpf), c.matricula, c.telefone].filter(Boolean).join(' · ')),
        c.observacao ? el('p', {}, el('b', {}, 'Observação: '), c.observacao) : null,
        el('h3', {}, 'Histórico de atendimentos'),
        r.historico.length ? el('table', {}, el('tbody', {}, r.historico.map(h => el('tr', {},
          el('td', {}, formatarData(h.criado_em)), el('td', {}, etiqueta(h.status)), el('td', {}, h.usuario || ''),
          el('td', {}, [h.melhor_emprestimo, h.melhor_cartao, h.observacao].filter(Boolean).join(' · ')))))) :
          el('p', { class: 'mudo' }, 'Ainda não foi atendido.'),
        el('div', { class: 'linha-botoes' }, el('button', { onclick: () => d.close() }, 'Fechar')));
      d.addEventListener('close', () => d.remove());
      document.body.append(d);
      d.showModal();
    }

    async function carregar() {
      const q = new URLSearchParams({ pagina: filtro.pagina });
      if (filtro.busca) q.set('busca', filtro.busca);
      if (filtro.status) q.set('status', filtro.status);
      try {
        const r = await api('GET', '/clientes?' + q);
        contagem.replaceChildren(...STATUS.map(s => el('span', { class: 'etiqueta ' + s.replace(/\s+/g, '-') }, `${s}: ${r.porStatus[s] || 0}`)));
        corpo.replaceChildren(...(r.clientes.length ? r.clientes.map(c => el('tr', { class: 'clicavel', title: 'Ver histórico', onclick: () => verHistorico(c).catch(tratarErro) },
          el('td', {}, c.nome),
          el('td', { class: 'num' }, c.cpf ? mostrarCpf_(c.cpf) : ''),
          el('td', {}, c.matricula),
          el('td', {}, c.telefone),
          el('td', {}, [c.orgao, c.origem].filter(Boolean).join(' · ')),
          el('td', {}, etiqueta(c.status), c.atendente ? el('div', { class: 'mudo pequeno' }, c.atendente) : null),
          el('td', { class: 'num' }, moeda(c.margem_emprestimo)),
          el('td', {}, c.melhor_emprestimo),
          el('td', {}, c.melhor_cartao),
          el('td', { class: 'mudo pequeno' }, formatarData(c.atualizado_em))))
          : [el('tr', {}, el('td', { colspan: 10, class: 'mudo' }, filtro.busca || filtro.status ? 'Nenhum cliente com esse filtro.' : 'A fila está vazia. Comece importando uma base.'))]));
        const paginas = Math.max(1, Math.ceil(r.total / r.porPagina));
        paginacao.replaceChildren(
          el('span', { class: 'mudo' }, `${r.total} cliente(s) · página ${r.pagina} de ${paginas}`),
          el('div', { class: 'linha-botoes' },
            el('button', { disabled: r.pagina <= 1, onclick: () => { filtro.pagina--; carregar(); } }, '← Anterior'),
            el('button', { disabled: r.pagina >= paginas, onclick: () => { filtro.pagina++; carregar(); } }, 'Próxima →')));
        paginacao.lastChild.style.marginTop = '0';
      } catch (e) { tratarErro(e); }
    }
    await carregar();
  }

  // ================================================================ importar

  async function telaImportar() {
    const alerta = el('div', { hidden: true });
    const base = el('input', { id: 'base', placeholder: 'Ex.: Governo, Previdência', maxlength: 120 });
    const arquivo = el('input', { id: 'arquivo', type: 'file', accept: '.csv,text/csv,.txt' });
    const colunas = {};
    const campos = [['nome', 'Coluna nome'], ['cpf', 'Coluna CPF'], ['matricula', 'Coluna matrícula'], ['telefone', 'Coluna telefone'], ['orgao', 'Coluna órgão']];
    campos.forEach(([k]) => { colunas[k] = el('input', { id: 'col-' + k, placeholder: 'automático' }); });
    const previa = el('div', { hidden: true });
    const btnPrevia = el('button', { class: 'primario' }, 'Conferir colunas');
    const historico = el('tbody');
    let texto = null;

    conteudo.replaceChildren(
      cabecalho('Importar base de clientes'),
      el('div', { class: 'painel' },
        el('p', { class: 'mudo' }, 'No Google Sheets: Arquivo › Fazer download › Valores separados por vírgula (.csv). ',
          'Clientes que já estão na fila não são duplicados: a importação só completa dados que estavam vazios (como o telefone) e nunca apaga status, margens ou observações.'),
        alerta,
        el('div', { class: 'grade-2' },
          el('div', {}, el('label', { for: 'base' }, 'Nome da base'), base),
          el('div', {}, el('label', { for: 'arquivo' }, 'Arquivo CSV'), arquivo)),
        el('details', {},
          el('summary', { class: 'mudo', style: 'margin-top:14px;cursor:pointer' }, 'Títulos das colunas (opcional — deixe vazio para detectar sozinho)'),
          el('div', { class: 'grade-3' }, campos.map(([k, rot]) => el('div', {}, el('label', { for: 'col-' + k }, rot), colunas[k])))),
        el('div', { class: 'linha-botoes' }, btnPrevia),
        previa),
      el('div', { class: 'painel' }, el('h2', {}, 'Últimas importações'),
        el('div', { class: 'tabela-rolagem' }, el('table', {},
          el('thead', {}, el('tr', {}, ['Quando', 'Base', 'Arquivo', 'Linhas', 'Novos', 'Completados', 'Por'].map(t => el('th', {}, t)))),
          historico))));

    arquivo.addEventListener('change', async () => {
      texto = null;
      previa.hidden = true;
      const f = arquivo.files[0];
      if (!f) return;
      if (f.size > 14 * 1024 * 1024) { mostrarAlerta(alerta, 'Arquivo grande demais (máximo 14 MB).'); return; }
      const bytes = await f.arrayBuffer();
      texto = new TextDecoder('utf-8').decode(bytes);
      // CSV salvo pelo Excel em português costuma vir em Windows-1252.
      if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(bytes);
      if (!base.value.trim()) base.value = f.name.replace(/\.[^.]+$/, '').slice(0, 120);
      mostrarAlerta(alerta, '');
    });

    function corpo() {
      const cols = {};
      campos.forEach(([k]) => { cols[k] = colunas[k].value.trim(); });
      return { base: base.value.trim(), csv: texto, colunas: cols, arquivo: arquivo.files[0] ? arquivo.files[0].name : '' };
    }

    btnPrevia.addEventListener('click', () => ocupado(btnPrevia, async () => {
      mostrarAlerta(alerta, '');
      if (!texto) throw new Error('Escolha o arquivo CSV.');
      const r = await api('POST', '/importacoes/previa', corpo());
      const btnImportar = el('button', { class: 'primario' }, `Importar ${r.linhas} cliente(s)`);
      btnImportar.addEventListener('click', () => ocupado(btnImportar, async () => {
        const x = await api('POST', '/importacoes', corpo());
        mostrarAlerta(alerta, `Importação concluída: ${x.linhasLidas} linhas lidas, ${x.novos} clientes novos na fila, ` +
          `${x.completados} já existentes ganharam dados que faltavam` + (x.ignorados ? `, ${x.ignorados} linhas sem nome/CPF/matrícula ignoradas` : '') + '.', 'ok');
        previa.hidden = true;
        arquivo.value = ''; texto = null;
        carregarHistorico();
      }).catch(e => mostrarAlerta(alerta, e.message)));
      previa.replaceChildren(
        el('h3', { style: 'margin-top:20px' }, 'Colunas encontradas'),
        el('div', { class: 'tabela-rolagem' }, el('table', {}, el('tbody', {}, campos.map(([k, rot]) => el('tr', {},
          el('td', { class: 'mudo' }, rot.replace('Coluna ', '')),
          el('td', {}, r.colunasAchadas[k] ? r.colunasAchadas[k] : el('span', { class: 'mudo' }, 'não encontrada'))))))),
        r.avisos.length ? el('div', { class: 'alerta aviso' }, r.avisos.join(' ')) : null,
        el('h3', { style: 'margin-top:16px' }, 'Primeiras linhas'),
        el('div', { class: 'tabela-rolagem' }, el('table', {},
          el('thead', {}, el('tr', {}, ['Nome', 'CPF', 'Matrícula', 'Telefone', 'Órgão'].map(t => el('th', {}, t)))),
          el('tbody', {}, r.amostra.map(a => el('tr', {}, ['nome', 'cpf', 'matricula', 'telefone', 'orgao'].map(k => el('td', {}, String(a[k] || '')))))))),
        el('div', { class: 'linha-botoes' }, btnImportar, el('span', { class: 'mudo' }, `Base: ${r.base}`)));
      previa.hidden = false;
    }).catch(e => mostrarAlerta(alerta, e.message)));

    async function carregarHistorico() {
      const r = await api('GET', '/importacoes');
      historico.replaceChildren(...(r.importacoes.length ? r.importacoes.map(i => el('tr', {},
        el('td', {}, formatarData(i.criado_em)), el('td', {}, i.base), el('td', { class: 'mudo' }, i.arquivo),
        el('td', { class: 'num' }, i.linhas_lidas), el('td', { class: 'num' }, i.novos), el('td', { class: 'num' }, i.completados),
        el('td', {}, i.usuario || ''))) : [el('tr', {}, el('td', { colspan: 7, class: 'mudo' }, 'Nenhuma importação ainda.'))]));
    }
    await carregarHistorico().catch(tratarErro);
  }

  // ================================================================ coeficientes

  async function telaCoeficientes() {
    const r = await api('GET', '/coeficientes');
    const admin = ehAdmin();
    const corpo = el('tbody');
    const alerta = el('div', { hidden: true });
    const ficticios = el('input', { type: 'checkbox', id: 'ficticios', checked: r.ficticios, disabled: !admin });
    ficticios.style.width = 'auto';

    function linha(c) {
      c = c || { banco: '', produto: 'emprestimo', prazo: '', calculo: 'coeficiente', fator: '', ativo: true };
      const tr = el('tr', {},
        el('td', {}, el('input', { 'data-c': 'banco', value: c.banco, disabled: !admin, 'aria-label': 'Banco' })),
        el('td', {}, el('select', { 'data-c': 'produto', disabled: !admin, 'aria-label': 'Produto' },
          el('option', { value: 'emprestimo', selected: c.produto === 'emprestimo' }, 'Empréstimo'),
          el('option', { value: 'cartao', selected: c.produto === 'cartao' }, 'Cartão'))),
        el('td', {}, el('input', { 'data-c': 'prazo', value: c.prazo, disabled: !admin, placeholder: 'ex.: 84', 'aria-label': 'Prazo' })),
        el('td', {}, el('select', { 'data-c': 'calculo', disabled: !admin, 'aria-label': 'Cálculo' },
          el('option', { value: 'coeficiente', selected: c.calculo === 'coeficiente' }, 'Coeficiente (÷)'),
          el('option', { value: 'multiplicador', selected: c.calculo === 'multiplicador' }, 'Multiplicador (×)'))),
        el('td', {}, el('input', { 'data-c': 'fator', value: c.fator === '' ? '' : String(c.fator).replace('.', ','), disabled: !admin, inputmode: 'decimal', 'aria-label': 'Fator' })),
        el('td', {}, el('input', { 'data-c': 'ativo', type: 'checkbox', checked: c.ativo, disabled: !admin, 'aria-label': 'Ativo', style: 'width:auto' })),
        admin ? el('td', {}, el('button', { class: 'link perigo', onclick: () => tr.remove() }, 'Remover')) : null);
      return tr;
    }
    corpo.append(...r.coeficientes.map(linha));

    const botoes = admin ? [
      el('button', { onclick: () => corpo.append(linha()) }, '+ Linha'),
      el('button', { class: 'primario', onclick: e => ocupado(e.target, async () => {
        const lista = [...corpo.children].map(tr => {
          const v = k => tr.querySelector(`[data-c="${k}"]`);
          return { banco: v('banco').value, produto: v('produto').value, prazo: v('prazo').value, calculo: v('calculo').value, fator: v('fator').value, ativo: v('ativo').checked };
        });
        const x = await api('PUT', '/coeficientes', { coeficientes: lista, ficticios: ficticios.checked });
        corpo.replaceChildren(...x.coeficientes.map(linha));
        mostrarAlerta(alerta, 'Coeficientes salvos. O próximo cliente já usa os valores novos.', 'ok');
      }).catch(err => mostrarAlerta(alerta, err.message)) }, 'Salvar')
    ] : [];

    conteudo.replaceChildren(
      cabecalho('Coeficientes dos bancos', ...botoes),
      el('div', { class: 'painel' },
        el('p', { class: 'mudo' }, 'Coeficiente: valor liberado = margem ÷ fator. Multiplicador: valor liberado = margem × fator (saque do cartão). ',
          'Com vários prazos para o mesmo banco, o atendimento mostra só o melhor.'),
        r.ficticios ? el('div', { class: 'alerta aviso' }, 'Estes valores são FICTÍCIOS, só para teste. Substitua pelos coeficientes reais de cada banco.') : null,
        alerta,
        el('div', { class: 'tabela-rolagem' }, el('table', {},
          el('thead', {}, el('tr', {}, ['Banco', 'Produto', 'Prazo', 'Cálculo', 'Fator', 'Ativo', admin ? '' : null].filter(x => x != null).map(t => el('th', {}, t)))),
          corpo)),
        el('label', { style: 'display:flex;gap:8px;align-items:center' }, ficticios, 'Marcar como valores de exemplo (mostra um aviso no atendimento)'),
        admin ? null : el('p', { class: 'mudo pequeno' }, 'Só administradores podem alterar os coeficientes.')));
  }

  // ================================================================ configurações

  async function telaConfiguracoes() {
    const r = await api('GET', '/configuracoes');
    const alerta = el('div', { hidden: true });
    const margem = el('input', { id: 'site_margem', type: 'url', value: r.site_margem, placeholder: 'https://…' });
    const lemitti = el('input', { id: 'lemitti', type: 'url', value: r.lemitti, placeholder: 'https://lemitti.com' });
    const salvar = el('button', { class: 'primario' }, 'Salvar');
    salvar.addEventListener('click', () => ocupado(salvar, async () => {
      await api('PUT', '/configuracoes', { site_margem: margem.value, lemitti: lemitti.value });
      mostrarAlerta(alerta, 'Configurações salvas.', 'ok');
    }).catch(e => mostrarAlerta(alerta, e.message)));
    conteudo.replaceChildren(cabecalho('Configurações'), el('div', { class: 'painel' },
      el('h2', {}, 'Atalhos do atendimento'),
      el('p', { class: 'mudo' }, 'Os botões abrem estes sites numa nova aba. O painel não faz login nem consultas automáticas nesses sites.'),
      alerta,
      el('label', { for: 'site_margem' }, 'Site de consulta de margem'), margem,
      el('label', { for: 'lemitti' }, 'Lemitti'), lemitti,
      el('div', { class: 'linha-botoes' }, salvar)));
  }

  // ================================================================ usuários e convites

  async function telaUsuarios() {
    const alerta = el('div', { hidden: true });
    const email = el('input', { id: 'conviteEmail', type: 'email', placeholder: 'pessoa@exemplo.com' });
    const papel = el('select', { id: 'convitePapel' }, el('option', { value: 'atendente' }, 'Atendente'), el('option', { value: 'admin' }, 'Administrador(a)'));
    const resultado = el('div', { hidden: true });
    const convidar = el('button', { class: 'primario' }, 'Enviar convite');
    const tabUsuarios = el('tbody');
    const tabConvites = el('tbody');

    function mostrarLink(r, para) {
      const campo = el('input', { readonly: true, value: r.link });
      resultado.replaceChildren(
        el('div', { class: r.emailEnviado ? 'alerta ok' : 'alerta aviso' },
          r.emailEnviado ? `Convite enviado para ${para}. Ele vale por ${r.expiraEmDias} dias.` : `Não consegui enviar o e-mail para ${para}. Mande o link abaixo por outro meio.`),
        el('div', { class: 'mudo pequeno' }, 'Link do convite (também pode ser enviado pelo WhatsApp; é de uso único):'),
        el('div', { class: 'caixa-link' }, campo, el('button', { onclick: async e => {
          e.target.textContent = (await copiar(r.link)) ? 'Copiado!' : 'Erro';
        } }, 'Copiar')));
      resultado.hidden = false;
    }

    convidar.addEventListener('click', () => ocupado(convidar, async () => {
      mostrarAlerta(alerta, '');
      const r = await api('POST', '/convites', { email: email.value, papel: papel.value });
      mostrarLink(r, email.value.trim());
      email.value = '';
      carregar();
    }).catch(e => mostrarAlerta(alerta, e.message)));

    conteudo.replaceChildren(
      cabecalho('Usuários'),
      el('div', { class: 'painel' },
        el('h2', {}, 'Convidar pessoa'),
        el('p', { class: 'mudo' }, 'Ninguém cria conta sozinho: a pessoa recebe um link por e-mail para criar a senha.'),
        alerta,
        el('div', { class: 'grade-2' },
          el('div', {}, el('label', { for: 'conviteEmail' }, 'E-mail'), email),
          el('div', {}, el('label', { for: 'convitePapel' }, 'Acesso'), papel)),
        el('div', { class: 'linha-botoes' }, convidar),
        resultado),
      el('div', { class: 'painel' }, el('h2', {}, 'Convites pendentes'),
        el('div', { class: 'tabela-rolagem' }, el('table', {},
          el('thead', {}, el('tr', {}, ['E-mail', 'Acesso', 'Enviado', 'Vence', 'Por', ''].map(t => el('th', {}, t)))), tabConvites))),
      el('div', { class: 'painel' }, el('h2', {}, 'Pessoas com acesso'),
        el('div', { class: 'tabela-rolagem' }, el('table', {},
          el('thead', {}, el('tr', {}, ['Nome', 'E-mail', 'Acesso', 'Último login', 'Situação', ''].map(t => el('th', {}, t)))), tabUsuarios))));

    async function carregar() {
      const r = await api('GET', '/usuarios');
      tabConvites.replaceChildren(...(r.convites.length ? r.convites.map(c => el('tr', {},
        el('td', {}, c.email), el('td', {}, c.papel === 'admin' ? 'Administrador(a)' : 'Atendente'),
        el('td', { class: 'mudo' }, formatarData(c.criado_em)), el('td', { class: 'mudo' }, formatarData(c.expira_em)),
        el('td', {}, c.criado_por || ''),
        el('td', {}, el('div', { class: 'linha-botoes', style: 'margin:0' },
          el('button', { class: 'link', onclick: e => ocupado(e.target, async () => {
            mostrarLink(await api('POST', `/convites/${c.id}/reenviar`), c.email); carregar();
          }).catch(tratarErro) }, 'Reenviar'),
          el('button', { class: 'link perigo', onclick: e => ocupado(e.target, async () => {
            await api('DELETE', `/convites/${c.id}`); toast('Convite cancelado.'); carregar();
          }).catch(tratarErro) }, 'Cancelar')))))
        : [el('tr', {}, el('td', { colspan: 6, class: 'mudo' }, 'Nenhum convite pendente.'))]));

      tabUsuarios.replaceChildren(...r.usuarios.map(u => {
        const souEu = u.id === eu.id;
        const mudar = (corpo, msg) => async e => ocupado(e.target, async () => {
          await api('PATCH', `/usuarios/${u.id}`, corpo); toast(msg); carregar();
        }).catch(tratarErro);
        return el('tr', {},
          el('td', {}, u.nome, souEu ? el('span', { class: 'mudo' }, ' (você)') : null),
          el('td', {}, u.email),
          el('td', {}, u.papel === 'admin' ? 'Administrador(a)' : 'Atendente'),
          el('td', { class: 'mudo' }, formatarData(u.ultimo_login_em) || 'nunca'),
          el('td', {}, u.ativo ? el('span', { class: 'etiqueta Consultado' }, 'Ativo') : el('span', { class: 'etiqueta Pulado' }, 'Desativado')),
          el('td', {}, souEu ? null : el('div', { class: 'linha-botoes', style: 'margin:0' },
            el('button', { class: 'link', onclick: mudar({ papel: u.papel === 'admin' ? 'atendente' : 'admin' }, 'Acesso alterado.') },
              u.papel === 'admin' ? 'Tornar atendente' : 'Tornar admin'),
            el('button', { class: 'link' + (u.ativo ? ' perigo' : ''), onclick: mudar({ ativo: !u.ativo }, u.ativo ? 'Acesso desativado.' : 'Acesso reativado.') },
              u.ativo ? 'Desativar' : 'Reativar'))));
      }));
    }
    await carregar();
  }

  // ================================================================ minha conta

  async function telaConta() {
    const alerta = el('div', { hidden: true });
    const atual = el('input', { id: 'senhaAtual', type: 'password', autocomplete: 'current-password' });
    const nova = el('input', { id: 'novaSenha', type: 'password', autocomplete: 'new-password', minlength: 8 });
    const conf = el('input', { id: 'confSenha', type: 'password', autocomplete: 'new-password', minlength: 8 });
    const salvar = el('button', { class: 'primario' }, 'Trocar senha');
    salvar.addEventListener('click', () => ocupado(salvar, async () => {
      if (nova.value.length < 8) throw new Error('A nova senha precisa ter pelo menos 8 caracteres.');
      if (nova.value !== conf.value) throw new Error('As duas senhas novas não são iguais.');
      await api('POST', '/auth/trocar-senha', { senhaAtual: atual.value, novaSenha: nova.value });
      atual.value = nova.value = conf.value = '';
      mostrarAlerta(alerta, 'Senha alterada. Você continua conectado(a) aqui e saiu dos outros aparelhos.', 'ok');
    }).catch(e => mostrarAlerta(alerta, e.message)));
    conteudo.replaceChildren(cabecalho('Minha conta'), el('div', { class: 'painel' },
      el('p', {}, el('b', {}, eu.nome), el('br'), el('span', { class: 'mudo' }, eu.email + ' · ' + (eu.papel === 'admin' ? 'Administrador(a)' : 'Atendente'))),
      el('h2', { style: 'margin-top:20px' }, 'Trocar senha'),
      alerta,
      el('div', { style: 'max-width:360px' },
        el('label', { for: 'senhaAtual' }, 'Senha atual'), atual,
        el('label', { for: 'novaSenha' }, 'Nova senha'), nova,
        el('label', { for: 'confSenha' }, 'Repita a nova senha'), conf),
      el('div', { class: 'linha-botoes' }, salvar)));
  }

  // ================================================================ rotas

  const ROTAS = {
    atendimento: telaAtendimento, fila: telaFila, importar: telaImportar, coeficientes: telaCoeficientes,
    configuracoes: telaConfiguracoes, usuarios: telaUsuarios, conta: telaConta
  };
  const SO_ADMIN = ['configuracoes', 'usuarios'];

  async function navegar() {
    let rota = (location.hash.replace(/^#\/?/, '') || 'atendimento').split('?')[0];
    if (!ROTAS[rota] || (SO_ADMIN.includes(rota) && !ehAdmin())) rota = 'atendimento';
    if (limpezaDaTela) { limpezaDaTela(); limpezaDaTela = null; }
    document.querySelectorAll('#menu a').forEach(a => a.classList.toggle('ativo', a.dataset.rota === rota));
    document.title = (document.querySelector(`#menu a[data-rota="${rota}"]`) || { textContent: 'Minha conta' }).textContent + ' · Painel de Atendimento';
    try { await ROTAS[rota](); } catch (e) { tratarErro(e); }
  }

  async function iniciar() {
    try { eu = (await api('GET', '/auth/eu')).usuario; } catch (e) { location.href = '/login'; return; }
    document.getElementById('nomeUsuario').textContent = eu.nome;
    if (!ehAdmin()) document.querySelectorAll('#menu [data-admin]').forEach(a => a.remove());
    document.getElementById('sair').addEventListener('click', async () => {
      await api('POST', '/auth/logout').catch(() => {});
      location.href = '/login?saiu=1';
    });
    window.addEventListener('hashchange', navegar);
    navegar();
  }
  iniciar();
})();
