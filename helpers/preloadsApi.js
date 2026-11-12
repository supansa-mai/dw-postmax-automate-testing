const { buildHmacHeaders } = require('./hmac');

// One endpoint for every company, each with its own key pair (the old /v1/public/preloads is gone)
const PATH = '/v1/public/preloads/tsd';

class PreloadsApi {
  /**
   * @param {import('@playwright/test').APIRequestContext} request
   * @param {string} apiURL
   * @param {{ huid: string, secretKey: string }} credentials the company's Public API key pair
   */
  constructor(request, apiURL, credentials) {
    this.request = request;
    this.url = `${apiURL}${PATH}`;
    this.credentials = credentials;
  }

  signedHeaders({ timestamp } = {}) {
    return buildHmacHeaders(this.credentials, 'POST', timestamp);
  }

  /**
   * Sends `fields` as multipart/form-data (`file` as { name, mimeType, buffer }); pass `headers` to override the
   * signed headers entirely. The order is created in the background: the response says CREATED_PENDING
   */
  async create(fields, { headers } = {}) {
    return this.request.post(this.url, { headers: headers ?? this.signedHeaders(), multipart: fields, timeout: 60000 });
  }
}

/** `buffer` as the multipart file of a preload */
const csvFile = (buffer, name = 'preload.csv') => ({ name, mimeType: 'text/csv', buffer });

module.exports = { PreloadsApi, csvFile };
