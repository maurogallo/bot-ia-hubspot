const crypto = require('crypto');
const axios = require('axios');
const logger = require('../../logger');
const config = require('../../config');

function createProvider(wompiConfig = config.wompi, billingConfig = config.billing) {
  const baseUrl = wompiConfig.environment === 'production'
    ? 'https://production.wompi.co/v1'
    : 'https://sandbox.wompi.co/v1';

  const isConfigured = () => Boolean(wompiConfig.privateKey && wompiConfig.publicKey && wompiConfig.eventsSecret);

  async function getMerchantAcceptance() {
    const { data } = await axios.get(`${baseUrl}/merchants/${wompiConfig.publicKey}`);
    const presigned = data?.data?.presigned_acceptance;
    const personal = data?.data?.presigned_personal_data_auth;
    return {
      acceptanceToken: presigned?.acceptance_token || '',
      acceptPersonalAuth: personal?.acceptance_token || '',
    };
  }

  async function createPaymentSession({ tenant, subscription, invoice, redirectUrl }) {
    if (!isConfigured()) throw new Error('Wompi no configurado: faltan WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY o WOMPI_EVENTS_SECRET');
    const amountInCents = invoice?.amount_in_cents || subscription?.amount_in_cents;
    if (!amountInCents) throw new Error('Monto de factura no definido');

    const { acceptanceToken, acceptPersonalAuth } = await getMerchantAcceptance();
    const reference = invoice?.reference;
    const customerEmail = tenant?.owner_email;
    const customerName = tenant?.owner_name || tenant?.business_name;
    const customerPhone = tenant?.owner_phone || '';

    const payload = {
      amount_in_cents: amountInCents,
      currency: 'COP',
      customer_email: customerEmail,
      payment_method: {
        type: 'PSE',
        user_type: 0,
        user_legal_id_type: 'CC',
        user_legal_id: '222222222222',
        financial_institution_code: '1',
        payment_description: `Suscripcion ${tenant?.business_name || tenant?.slug} - plan ${subscription?.plan}`.slice(0, 64),
      },
      customer_data: {
        full_name: customerName,
        phone_number: customerPhone,
      },
      reference,
      redirect_url: redirectUrl || billingConfig.successUrl,
    };

    if (acceptanceToken) payload.acceptance_token = acceptanceToken;
    if (acceptPersonalAuth) payload.accept_personal_auth = acceptPersonalAuth;

    const { data } = await axios.post(`${baseUrl}/transactions`, payload, {
      headers: { Authorization: `Bearer ${wompiConfig.privateKey}`, 'Content-Type': 'application/json' },
    });

    const tx = data?.data;
    if (!tx) throw new Error('Wompi no devolvio transaccion');

    let redirectUrlFromWompi = null;
    const maxAttempts = 20;
    for (let i = 0; i < maxAttempts; i++) {
      const current = await getTransactionStatus(tx.id);
      const asyncUrl = current?.payment_method?.extra?.async_payment_url;
      if (asyncUrl) {
        redirectUrlFromWompi = asyncUrl;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return {
      transactionId: tx.id,
      reference,
      status: tx.status || 'PENDING',
      redirectUrl: redirectUrlFromWompi || null,
    };
  }

  async function getTransactionStatus(transactionId) {
    const { data } = await axios.get(`${baseUrl}/transactions/${transactionId}`, {
      headers: { Authorization: `Bearer ${wompiConfig.publicKey}` },
    });
    return data?.data || null;
  }

  async function getFinancialInstitutions() {
    const { data } = await axios.get(`${baseUrl}/pse/financial_institutions`, {
      headers: { Authorization: `Bearer ${wompiConfig.publicKey}` },
    });
    return data?.data || [];
  }

  function extractChecksum(event, headerChecksum) {
    if (headerChecksum) return headerChecksum;
    return event?.signature?.checksum || null;
  }

  function verifyWebhookSignature(event, headerChecksum) {
    if (!wompiConfig.eventsSecret) return false;
    const checksum = extractChecksum(event, headerChecksum);
    if (!checksum) return false;

    const properties = event?.signature?.properties || [];
    let concat = '';
    for (const prop of properties) {
      const value = prop.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), event?.data);
      concat += value !== undefined && value !== null ? String(value) : '';
    }
    concat += event.timestamp || '';
    concat += wompiConfig.eventsSecret;

    const computed = crypto.createHash('sha256').update(concat).digest('hex');
    return computed.toUpperCase() === checksum.toUpperCase();
  }

  async function handleTransactionUpdated(transaction, { store }) {
    const reference = transaction?.reference;
    if (!reference) return { handled: false, reason: 'sin referencia' };

    let invoice = await store.getInvoiceByReference(reference);
    if (!invoice) invoice = await store.getInvoiceByTransactionId(transaction.id);
    if (!invoice) {
      logger.warn('Webhook Wompi: factura no encontrada para referencia', { reference, transactionId: transaction.id });
      return { handled: false, reason: 'factura no encontrada' };
    }

    const subscription = invoice.subscription_id
      ? await store.getSubscriptionByTenant(invoice.tenant_id)
      : null;

    const statusMap = {
      APPROVED: 'paid',
      DECLINED: 'failed',
      VOIDED: 'voided',
      ERROR: 'failed',
    };
    const invoiceStatus = statusMap[transaction.status] || 'pending';

    const update = {
      status: invoiceStatus,
      payment_method: transaction.payment_method_type || null,
      metadata: { wompi_status: transaction.status, transaction_id: transaction.id },
    };
    if (transaction.status === 'APPROVED') {
      update.paid_at = new Date().toISOString();
    }
    const savedInvoice = await store.saveInvoice({
      tenantId: invoice.tenant_id,
      subscriptionId: invoice.subscription_id,
      providerTransactionId: transaction.id,
      reference,
      amountInCents: invoice.amount_in_cents,
      currency: invoice.currency,
      status: invoiceStatus,
      paymentMethod: transaction.payment_method_type || null,
      metadata: { wompi_status: transaction.status },
      paidAt: transaction.status === 'APPROVED' ? new Date().toISOString() : null,
    });

    let tenant = null;
    try {
      const tenants = await store.getAllTenants();
      tenant = tenants.find((t) => t.id === invoice.tenant_id) || null;
    } catch (e) { /* ignore */ }

    if (transaction.status === 'APPROVED') {
      const now = new Date();
      const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      if (subscription) {
        await store.updateSubscription(subscription.id, {
          status: 'active',
          current_period_start: subscription.current_period_start || now.toISOString(),
          current_period_end: periodEnd.toISOString(),
        });
      } else {
        await store.createSubscription({
          tenantId: invoice.tenant_id,
          plan: invoice.metadata?.plan || tenant?.plan || 'starter',
          status: 'active',
          provider: 'wompi',
          amountInCents: invoice.amount_in_cents,
          currency: invoice.currency,
          currentPeriodStart: now.toISOString(),
          currentPeriodEnd: periodEnd.toISOString(),
        });
      }
      await store.reactivateTenant(invoice.tenant_id);
      await store.setTenantBillingStatus(invoice.tenant_id, 'active', periodEnd.toISOString());
      logger.info('Pago aprobado Wompi', { reference, tenantId: invoice.tenant_id, amount: invoice.amount_in_cents });
    } else if (invoiceStatus === 'failed') {
      if (subscription) {
        await store.updateSubscription(subscription.id, { status: 'past_due' });
      }
      await store.setTenantBillingStatus(invoice.tenant_id, 'past_due');
      logger.warn('Pago fallido Wompi', { reference, tenantId: invoice.tenant_id, status: transaction.status });
    }

    return { handled: true, invoice: savedInvoice, tenant };
  }

  return {    isConfigured,
    createPaymentSession,
    getTransactionStatus,
    getFinancialInstitutions,
    verifyWebhookSignature,
    handleTransactionUpdated,
  };
}

module.exports = { createProvider };
