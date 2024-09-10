const polarityRequest = require('../polarity-request');
const { ApiRequestError } = require('../errors');
const { getLogger } = require('../logger');
const { convertPolarityTypeToThreatConnectSingular } = require('../tc-request-utils');
const SUCCESS_CODES = [200];

async function getOwners(entity, options) {
  const Logger = getLogger();

  const indicatorType = convertPolarityTypeToThreatConnectSingular(entity.type);

  const requestOptions = {
    uri: `${options.url}/v2/indicators/${indicatorType}/${encodeURIComponent(entity.value)}/owners`,
    qs: {
      includes: 'additional'
    },
    method: 'GET'
  };

  Logger.trace({ requestOptions }, 'Request Options');

  const apiResponse = await polarityRequest.request(requestOptions, options);

  Logger.trace({ apiResponse }, 'Lookup API Response');

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

  return apiResponse.body;
}

module.exports = {
  getOwners
};
