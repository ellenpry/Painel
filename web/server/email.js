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

// Cores da identidade Libera (kit em /identidade). E-mail não aceita variáveis CSS nem fontes do servidor,
// então os valores vão direto no HTML, com IBM Plex Sans primeiro e fontes comuns de reserva.
const COR = { primaria: '#1d5e94', texto: '#15181c', texto2: '#4d535b', borda: '#dfe2e6', fundo: '#f4f5f6' };
const FONTE = "'IBM Plex Sans', 'Segoe UI', Arial, sans-serif";
const MONO = "'IBM Plex Mono', Consolas, 'Courier New', monospace";

function montar(titulo, paragrafos, botao, link, rodape) {
  const html = `<div style="background:${COR.fundo};padding:24px 12px;font-family:${FONTE};color:${COR.texto}">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid ${COR.borda};border-radius:6px">
    <tr><td style="padding:24px 28px 0">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:32px;height:32px;background:${COR.primaria};border-radius:6px;color:#ffffff;font-weight:600;font-size:18px;text-align:center;line-height:32px">L.</td>
        <td style="padding-left:10px"><div style="font-size:18px;font-weight:600;letter-spacing:-0.02em">Libera</div>
          <div style="font-size:11px;color:${COR.texto2}">Painel de Atendimento</div></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:20px 28px 28px;font-size:15px;line-height:1.5">
      <h1 style="font-size:22px;font-weight:600;letter-spacing:-0.015em;margin:0 0 12px">${escapar(titulo)}</h1>
      ${paragrafos.map(p => `<p style="margin:0 0 12px">${escapar(p)}</p>`).join('')}
      <p style="margin:20px 0"><a href="${escapar(link)}" style="display:inline-block;background:${COR.primaria};color:#ffffff;padding:11px 20px;border-radius:4px;text-decoration:none;font-weight:500">${escapar(botao)}</a></p>
      <p style="color:${COR.texto2};font-size:13px;margin:0 0 12px">Se o botão não funcionar, copie este endereço no navegador:<br><span style="font-family:${MONO};font-size:12px;word-break:break-all">${escapar(link)}</span></p>
      <p style="color:${COR.texto2};font-size:13px;margin:0">${escapar(rodape)}</p>
    </td></tr>
  </table></div>`;
  const texto = `${titulo}\n\n${paragrafos.join('\n\n')}\n\n${botao}: ${link}\n\n${rodape}\n\n— Libera · Painel de Atendimento`;
  return { html, texto };
}

async function enviar({ para, assunto, html, texto }) {
  const msg = { from: process.env.EMAIL_REMETENTE || 'Libera <nao-responda@painel.local>', to: para, subject: assunto, html, text: texto };
  if (process.env.EMAIL_MODO === 'memoria') { enviados.push(msg); return; }
  await obterTransporte().sendMail(msg);
}

async function enviarConvite({ para, link, convidadoPor, horas }) {
  const { html, texto } = montar('Você foi convidado(a) para a Libera',
    [`${convidadoPor} convidou você para usar a Libera, o painel de atendimento da equipe.`, 'Clique no botão abaixo para criar sua senha e entrar.'],
    'Aceitar convite', link, `O convite vale por ${Math.round(horas / 24)} dias. Se você não esperava este e-mail, pode ignorá-lo.`);
  await enviar({ para, assunto: 'Seu convite para a Libera', html, texto });
}

async function enviarRedefinicao({ para, nome, link, minutos }) {
  const { html, texto } = montar('Redefinição de senha',
    [`Olá, ${nome}.`, 'Recebemos um pedido para redefinir a senha da sua conta na Libera.'],
    'Criar nova senha', link, `O link vale por ${minutos} minutos e só pode ser usado uma vez. Se não foi você, ignore este e-mail: sua senha continua a mesma.`);
  await enviar({ para, assunto: 'Redefinir sua senha — Libera', html, texto });
}

module.exports = { enviarConvite, enviarRedefinicao, enviados };
