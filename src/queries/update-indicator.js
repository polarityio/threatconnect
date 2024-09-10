const polarityRequest = require('../polarity-request');
const { ApiRequestError } = require('../errors');
const { getLogger } = require('../logger');
const SUCCESS_CODES = [200];

async function updateIndicator(indicatorId, field, fieldValue, options) {
  const Logger = getLogger();

  const requestOptions = {
    uri: `${options.url}/v3/indicators/${indicatorId}`,
    method: 'PUT',
    body: {}
  };

  requestOptions.body[field] = fieldValue;

  Logger.trace({ requestOptions }, 'Request Options');

  const apiResponse = await polarityRequest.request(requestOptions, options);

  Logger.trace({ apiResponse }, 'Update Indicator API Response');

  if (
    !SUCCESS_CODES.includes(apiResponse.statusCode) ||
    (apiResponse.body && apiResponse.body.status && apiResponse.body.status !== 'Success')
  ) {
    throw new ApiRequestError(
      `Unexpected status code ${apiResponse.statusCode} received when making request to the ThreatConnect API`,
      {
        statusCode: apiResponse.statusCode,
        requestOptions: apiResponse.requestOptions,
        responseBody: apiResponse.body
      }
    );
  }

  const response = {};
  if (apiResponse.body.data && apiResponse.body.data[field]) {
    response[field] = apiResponse.body.data[field];
  } else {
    Logger.error(`Update Indicator response body does not include the updated field value for ${field}`);
  }

  return response;
}

module.exports = {
  updateIndicator
};
