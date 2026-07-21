const axios = require('axios');
const logger = require('./logger');
const config = require('./config');

const BASE_URL = 'https://api.hubapi.com';

let accessToken = config.hubspot.accessToken;
let refreshToken = config.hubspot.refreshToken;

async function refreshAccessToken() {
  if (!config.hubspot.clientId || !config.hubspot.clientSecret || !refreshToken) {
    logger.warn('Cannot refresh HubSpot token: missing credentials or refresh token');
    return false;
  }

  try {
    const response = await axios.post(`${BASE_URL}/oauth/v1/token`,
      `grant_type=refresh_token&client_id=${config.hubspot.clientId}&client_secret=${config.hubspot.clientSecret}&refresh_token=${refreshToken}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    accessToken = response.data.access_token;
    refreshToken = response.data.refresh_token;
    logger.info('HubSpot token refreshed successfully');
    return true;
  } catch (error) {
    logger.error('Failed to refresh HubSpot token', {
      error: error.response?.data || error.message,
    });
    return false;
  }
}

async function makeRequest(method, path, data = null) {
  if (!accessToken) {
    throw new Error('HubSpot access token not configured. Set HUBSPOT_ACCESS_TOKEN or complete OAuth.');
  }

  const makeAttempt = async () => {
    return axios({
      method,
      url: `${BASE_URL}${path}`,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data,
      timeout: 15000,
    });
  };

  try {
    return await makeAttempt();
  } catch (error) {
    if (error.response?.status === 401 && refreshToken) {
      logger.info('HubSpot token expired, attempting refresh');
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return await makeAttempt();
      }
    }
    const status = error.response?.status;
    const detail = error.response?.data?.message || error.message;
    throw new Error(`HubSpot API error (${status}): ${detail}`);
  }
}

async function createContact(email, properties = {}) {
  logger.info('Creating HubSpot contact', { email });
  const response = await makeRequest('POST', '/crm/v3/objects/contacts', {
    properties: {
      email,
      firstname: properties.name || 'Lead desde Bot',
      phone: properties.phone || '',
      ...properties.additional,
    },
  });
  logger.info('HubSpot contact created', { id: response.data.id });
  return response.data;
}

async function searchContact(email) {
  try {
    const response = await makeRequest('POST', '/crm/v3/objects/contacts/search', {
      filterGroups: [{
        filters: [{ propertyName: 'email', operator: 'EQ', value: email }],
      }],
    });
    return response.data.results[0] || null;
  } catch (error) {
    logger.error('HubSpot contact search failed', { error: error.message, email });
    return null;
  }
}

async function getOrCreateContact(email, properties = {}) {
  const existing = await searchContact(email);
  if (existing) {
    logger.info('HubSpot contact already exists', { id: existing.id, email });
    return existing;
  }
  return createContact(email, properties);
}

async function createDeal(contactId, dealName, amount = null, properties = {}) {
  logger.info('Creating HubSpot deal', { contactId, dealName });
  const response = await makeRequest('POST', '/crm/v3/objects/deals', {
    properties: {
      dealname: dealName,
      amount: amount ? String(amount) : undefined,
      pipeline: properties.pipeline || 'default',
      dealstage: properties.dealstage || 'appointmentscheduled',
    },
  });

  await makeRequest('PUT',
    `/crm/v3/objects/deals/${response.data.id}/associations/contact/${contactId}/1`,
    {}
  );
  return response.data;
}

async function getAuthorizationUrl() {
  if (!config.hubspot.clientId) {
    throw new Error('HubSpot client ID not configured. Set HUBSPOT_CLIENT_ID.');
  }
  const scopes = 'crm.objects.contacts.write crm.objects.contacts.read crm.objects.deals.write';
  return `https://app.hubspot.com/oauth/authorize?client_id=${config.hubspot.clientId}&redirect_uri=${encodeURIComponent(config.hubspot.redirectUri)}&scope=${encodeURIComponent(scopes)}`;
}

async function exchangeAuthorizationCode(code) {
  const response = await axios.post(`${BASE_URL}/oauth/v1/token`,
    `grant_type=authorization_code&client_id=${config.hubspot.clientId}&client_secret=${config.hubspot.clientSecret}&redirect_uri=${encodeURIComponent(config.hubspot.redirectUri)}&code=${code}`,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  accessToken = response.data.access_token;
  refreshToken = response.data.refresh_token;

  logger.info('HubSpot OAuth tokens obtained');
  return response.data;
}

module.exports = {
  createContact,
  searchContact,
  getOrCreateContact,
  createDeal,
  getAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
};
