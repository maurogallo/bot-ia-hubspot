// Puerto de billing — contrato para la pasarela de pagos.
// El dominio/adaptadores dependen de esta interfaz, nunca de la pasarela concreta.
//
// Implementaciones: wompi-provider.js (Colombia — PSE/Nequi/tarjetas)

// createPaymentSession({ tenant, subscription, invoice, redirectUrl })
//   → { transactionId, reference, status, redirectUrl }
//
// getTransactionStatus(transactionId)
//   → transacción completa de la pasarela
//
// getFinancialInstitutions()
//   → lista de instituciones financieras (para PSE)
//
// verifyWebhookSignature(event, headerChecksum)
//   → boolean, valida autenticidad del evento
//
// handleTransactionUpdated(transaction, { store })
//   → { handled, invoice, tenant } actualiza factura/suscripción/tenant

module.exports = {};
