const path = require('node:path');

/** Lógica compartilhada com o Apps Script (src/Logica.gs). */
const logica = require(path.join(__dirname, '..', '..', 'src', 'Logica.gs'));

/** Endereço público para montar links de e-mail. APP_URL tem prioridade. */
function urlBase(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  const host = (req.app.get('trust proxy') && req.get('x-forwarded-host')) || req.get('host');
  return `${req.protocol}://${String(host).split(',')[0].trim()}`;
}

module.exports = { logica, urlBase };
