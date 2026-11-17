const path = require('node:path');
const express = require('express');
const s = require('./seguranca');
const { logica } = require('./util');

function criarApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : 1);

  // PERMITIR_IFRAME=true só para pré-visualização dentro de outro site; o padrão bloqueia (clickjacking).
  const permitirIframe = process.env.PERMITIR_IFRAME === 'true';
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      // Os links de convite e de senha levam o token na URL: não deixar vazar no Referer.
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'self'" +
        (permitirIframe ? '' : "; frame-ancestors 'none'")
    });
    if (!permitirIframe) res.set('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.json({ limit: '15mb' }));
  app.use((req, res, next) => { req.body = req.body || {}; next(); });
  app.use(s.carregarUsuario);

  app.get('/saude', (req, res) => res.json({ ok: true }));

  // ---------------------------------------------------------------- API
  const api = express.Router();
  api.use(s.exigirCabecalhoAjax);
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use('/auth', require('./rotas/auth'));
  api.use(s.exigirLogin);
  api.use('/atendimento', require('./rotas/atendimento'));
  api.use(require('./rotas/clientes'));
  api.use(require('./rotas/admin'));
  api.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
  app.use('/api', api);

  // ---------------------------------------------------------------- páginas
  const publico = path.join(__dirname, '..', 'public');
  const pagina = nome => (req, res) => res.sendFile(path.join(publico, nome));

  // A mesma lógica de cálculo da planilha, servida para o navegador.
  const codigoLogica = logica.codigoLogicaParaPainel_();
  app.get('/js/logica.js', (req, res) => res.type('application/javascript').send(codigoLogica));

  app.get('/', (req, res) => res.redirect(req.usuario ? '/app' : '/login'));
  app.get('/login', (req, res, next) => (req.usuario ? res.redirect('/app') : pagina('login.html')(req, res, next)));
  app.get('/esqueci-senha', pagina('esqueci-senha.html'));
  app.get('/redefinir-senha', pagina('redefinir-senha.html'));
  app.get('/convite', pagina('convite.html'));
  app.get('/app', (req, res, next) => (req.usuario ? pagina('app.html')(req, res, next) : res.redirect('/login')));
  app.use(express.static(publico, { index: false, maxAge: '1h' }));

  // ---------------------------------------------------------------- erros
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'Arquivo grande demais (limite 15 MB).' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'Requisição inválida.' });
    const status = err.status && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ erro: status >= 500 ? 'Erro interno. Tente de novo.' : err.message });
  });

  return app;
}

module.exports = { criarApp };
