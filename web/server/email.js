// Envio de e-mails (convites e recuperação de senha).
// Em desenvolvimento o docker compose sobe o Mailpit: nada sai para a internet,
// e os e-mails aparecem em http://localhost:8025.
const nodemailer = require('nodemailer');

let transporte;
function obterTransporte() {
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: Number(process.env.SMTP_PORT || 1025),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
  }
  return transporte;
}

const enviados = []; // usado nos testes quando EMAIL_MODO=memoria

function escapar(t) {
  return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function montar(titulo, paragrafos, botao, link, rodape) {
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;color:#202124">
    <h2 style="font-weight:500">${escapar(titulo)}</h2>
    ${paragrafos.map(p => `<p>${escapar(p)}</p>`).join('')}
    <p><a href="${escapar(link)}" style="display:inline-block;background:#1a73e8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${escapar(botao)}</a></p>
    <p style="color:#5f6368;font-size:13px">Se o botão não funcionar, copie este endereço no navegador:<br>${escapar(link)}</p>
    <p style="color:#5f6368;font-size:13px">${escapar(rodape)}</p></div>`;
  const texto = `${titulo}\n\n${paragrafos.join('\n\n')}\n\n${botao}: ${link}\n\n${rodape}`;
  return { html, texto };
}

async function enviar({ para, assunto, html, texto }) {
  const msg = { from: process.env.EMAIL_REMETENTE || 'Painel de Atendimento <nao-responda@painel.local>', to: para, subject: assunto, html, text: texto };
  if (process.env.EMAIL_MODO === 'memoria') { enviados.push(msg); return; }
  await obterTransporte().sendMail(msg);
}

async function enviarConvite({ para, link, convidadoPor, horas }) {
  const { html, texto } = montar('Você foi convidado(a) para o Painel de Atendimento',
    [`${convidadoPor} convidou você para usar o Painel de Atendimento.`, 'Clique no botão abaixo para criar sua senha e entrar.'],
    'Aceitar convite', link, `O convite vale por ${Math.round(horas / 24)} dias. Se você não esperava este e-mail, pode ignorá-lo.`);
  await enviar({ para, assunto: 'Convite para o Painel de Atendimento', html, texto });
}

async function enviarRedefinicao({ para, nome, link, minutos }) {
  const { html, texto } = montar('Redefinição de senha',
    [`Olá, ${nome}.`, 'Recebemos um pedido para redefinir a senha da sua conta no Painel de Atendimento.'],
    'Criar nova senha', link, `O link vale por ${minutos} minutos e só pode ser usado uma vez. Se não foi você, ignore este e-mail: sua senha continua a mesma.`);
  await enviar({ para, assunto: 'Redefinir sua senha — Painel de Atendimento', html, texto });
}

module.exports = { enviarConvite, enviarRedefinicao, enviados };
