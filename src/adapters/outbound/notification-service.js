const nodemailer = require('nodemailer');
const logger = require('../../logger');
const config = require('../../config');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!config.smtp?.host) {
    logger.warn('SMTP not configured, email notifications disabled');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port || 587,
    secure: config.smtp.secure || false,
    auth: {
      user: config.smtp.user || '',
      pass: config.smtp.pass || '',
    },
  });
  return transporter;
}

async function sendNewLeadNotification(tenant, leadData, memory) {
  const t = getTransporter();
  if (!t) return;

  const ownerEmail = tenant?.owner_email;
  if (!ownerEmail) return;

  const businessName = tenant?.business_name || config.business.name;
  const name = memory.contact_name || 'Sin nombre';
  const email = memory.contact_email || 'Sin email';
  const phone = memory.contact_phone || 'Sin telefono';
  const service = memory.service_interest || leadData?.detected_service || 'No especificado';

  try {
    await t.sendMail({
      from: config.smtp.from || 'bot@neowebstudio.com',
      to: ownerEmail,
      subject: `Nuevo lead: ${name} - ${businessName}`,
      html: `
        <h2>Nuevo lead capturado</h2>
        <p><strong>Negocio:</strong> ${businessName}</p>
        <p><strong>Nombre:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Telefono:</strong> ${phone}</p>
        <p><strong>Servicio de interes:</strong> ${service}</p>
        <hr>
        <p><em>Enviado automaticamente por Bot IA HubSpot</em></p>
      `,
    });
    logger.info('Lead notification sent', { to: ownerEmail, business: businessName });
  } catch (err) {
    logger.error('Failed to send lead notification', { error: err.message, to: ownerEmail });
  }
}

module.exports = { sendNewLeadNotification };
