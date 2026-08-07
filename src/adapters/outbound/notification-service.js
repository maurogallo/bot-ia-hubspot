const nodemailer = require('nodemailer');
const logger = require('../../logger');
const config = require('../../config');

let transporter = null;

function formatMoney(cents, currency) {
  const value = (cents || 0) / 100;
  const symbol = currency === 'COP' ? '$' : '';
  return `${symbol}${value.toLocaleString('es-CO')} COP`;
}

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

async function sendPaymentNotification(tenant, invoice, subscription) {
  const t = getTransporter();
  if (!t) return;
  const ownerEmail = tenant?.owner_email;
  if (!ownerEmail) return;

  const businessName = tenant?.business_name || config.business.name;
  const amount = formatMoney(invoice?.amount_in_cents, invoice?.currency);

  let subject, body;
  if (invoice?.status === 'paid') {
    subject = `Pago confirmado: ${businessName}`;
    body = `
      <h2>Pago recibido</h2>
      <p><strong>Negocio:</strong> ${businessName}</p>
      <p><strong>Plan:</strong> ${subscription?.plan || tenant?.plan || '-'}</p>
      <p><strong>Monto:</strong> ${amount}</p>
      <p><strong>Referencia:</strong> ${invoice.reference || '-'}</p>
      <p>Tu suscripcion esta activa por 30 dias mas. Gracias por confiar en nosotros.</p>
    `;
  } else {
    subject = `Pago fallido: ${businessName}`;
    body = `
      <h2>No pudimos procesar tu pago</h2>
      <p><strong>Negocio:</strong> ${businessName}</p>
      <p><strong>Monto:</strong> ${amount}</p>
      <p><strong>Referencia:</strong> ${invoice.reference || '-'}</p>
      <p>Tu suscripcion quedara suspendida si no completas el pago. Vuelve a intentarlo o contacta a soporte.</p>
    `;
  }

  try {
    await t.sendMail({ from: config.smtp.from || 'bot@neowebstudio.com', to: ownerEmail, subject, html: body });
    logger.info('Payment notification sent', { to: ownerEmail, status: invoice?.status });
  } catch (err) {
    logger.error('Failed to send payment notification', { error: err.message, to: ownerEmail });
  }
}

async function sendTenantSuspendedNotification(tenant) {
  const t = getTransporter();
  if (!t) return;
  const ownerEmail = tenant?.owner_email;
  if (!ownerEmail) return;
  const businessName = tenant?.business_name || config.business.name;

  try {
    await t.sendMail({
      from: config.smtp.from || 'bot@neowebstudio.com',
      to: ownerEmail,
      subject: `Suscripcion suspendida: ${businessName}`,
      html: `
        <h2>Tu suscripcion fue suspendida</h2>
        <p><strong>Negocio:</strong> ${businessName}</p>
        <p>No se pudo procesar el pago de tu suscripcion y tu bot quedo en pausa.</p>
        <p>Para reactivarlo, ingresa a tu panel y realiza el pago de la suscripcion.</p>
        <p><em>Enviado automaticamente por Bot IA HubSpot</em></p>
      `,
    });
    logger.info('Suspension notification sent', { to: ownerEmail });
  } catch (err) {
    logger.error('Failed to send suspension notification', { error: err.message, to: ownerEmail });
  }
}

async function sendQuotaWarning(tenant, usage, limit) {
  const t = getTransporter();
  if (!t) return;
  const ownerEmail = tenant?.owner_email;
  if (!ownerEmail) return;
  const businessName = tenant?.business_name || config.business.name;

  try {
    await t.sendMail({
      from: config.smtp.from || 'bot@neowebstudio.com',
      to: ownerEmail,
      subject: `Alerta de uso: ${businessName} alcanzo el ${Math.round((usage / limit) * 100)}%`,
      html: `
        <h2>Has alcanzado el 80% de tu cuota</h2>
        <p><strong>Negocio:</strong> ${businessName}</p>
        <p><strong>Conversaciones usadas:</strong> ${usage} de ${limit}</p>
        <p>Considera ampliar tu plan para evitar quedarte sin conversaciones este mes.</p>
        <p><em>Enviado automaticamente por Bot IA HubSpot</em></p>
      `,
    });
    logger.info('Quota warning sent', { to: ownerEmail, usage, limit });
  } catch (err) {
    logger.error('Failed to send quota warning', { error: err.message, to: ownerEmail });
  }
}

module.exports = {
  sendNewLeadNotification,
  sendPaymentNotification,
  sendTenantSuspendedNotification,
  sendQuotaWarning,
};
