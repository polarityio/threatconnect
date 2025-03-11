const polarityRequest = require('../polarity-request');
const { ApiRequestError } = require('../errors');
const { getLogger } = require('../logger');
const SUCCESS_CODES = [200];

async function createCase(payload, options) {
  const Logger = getLogger();

  const requestOptions = {
    uri: `${options.url}/v3/cases`,
    method: 'POST',
    body: {}
  };

  const name = payload.name;
  if (name && name !== 'undefined') {
    requestOptions.body = {
      name: name
    };
  }

  const severity = payload.severity;
  if (severity && severity !== 'undefined') {
    requestOptions.body = {
      severity: severity
    };
  }

  const status = payload.status;
  if (status && status !== 'undefined') {
    requestOptions.body = {
      status: status
    };
  }

  const associateIndicator = payload.associateIndicator;
  if (associateIndicator && associateIndicator !== 'undefined') {
    requestOptions.body = {
      associatedIndicators: { data: [{ id: payload.indicatorId }] }
    };
  }

  Logger.trace({ requestOptions }, 'Request Options');

  const apiResponse = await polarityRequest.request(requestOptions, options);

  Logger.trace({ apiResponse }, 'Create Case API Response');

  if (
    !SUCCESS_CODES.includes(apiResponse.statusCode) ||
    (apiResponse.body && apiResponse.body.status && apiResponse.body.status !== 'Success')
  ) {
    throw new ApiRequestError(
      `Unexpected status code ${apiResponse.statusCode} received while creating case via ThreatConnect API`,
      {
        statusCode: apiResponse.statusCode,
        requestOptions: apiResponse.requestOptions,
        responseBody: apiResponse.body
      }
    );
  }

  return apiResponse.body.data;
}

module.exports = {
  createCase
};
