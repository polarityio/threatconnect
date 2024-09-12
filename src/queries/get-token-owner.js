const async = require('async');
const polarityRequest = require('../polarity-request');
const { ApiRequestError } = require('../errors');
const { getLogger } = require('../logger');
const SUCCESS_CODES = [200];

async function getTokenOwner(options) {
  const Logger = getLogger();
  const indicatorsById = {};

  const requestOptions = {
    uri: `${options.url}/v3/security/users`,
    useQuerystring: true,
    method: 'GET'
  };

  Logger.trace({ requestOptions }, 'Request Options');

  const apiResponse = await polarityRequest.request(requestOptions, options);

  if (
    !SUCCESS_CODES.includes(apiResponse.statusCode) ||
    (apiResponse.body && apiResponse.body.status && apiResponse.body.status !== 'Success')
  ) {
    throw new ApiRequestError(
      `Unexpected status code ${apiResponse.statusCode} received when fetching API Token details via the ThreatConnect API`,
      {
        statusCode: apiResponse.statusCode,
        requestOptions: apiResponse.requestOptions,
        responseBody: apiResponse.body
      }
    );
  }

  Logger.trace({ apiResponse }, 'getTokenOwner API Response');

  let tokenOwner = null;
  const match = apiResponse.body.data.find((user) => user.userName === options.accessId);
  if (match) {
    tokenOwner = match.owner;
  }

  return tokenOwner;
}

module.exports = {
  getTokenOwner
};
