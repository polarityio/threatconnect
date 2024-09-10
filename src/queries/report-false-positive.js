/*
 * Copyright (c) 2024, Polarity.io, Inc.
 */

const polarityRequest = require('../polarity-request');
const { ApiRequestError } = require('../errors');
const { getLogger } = require('../logger');
const { convertPolarityTypeToThreatConnectPlural } = require('../tc-request-utils');
const SUCCESS_CODES = [200];

async function reportFalsePositive(entity, owner, options) {
  const Logger = getLogger();

  const indicatorType = convertPolarityTypeToThreatConnectPlural(entity.type);

  const requestOptions = {
    uri: `${options.url}/v2/indicators/${indicatorType}/${encodeURIComponent(entity.value)}/falsePositive`,
    qs: {
      owner
    },
    method: 'POST'
  };

  Logger.trace({ requestOptions }, 'Request Options');

  const apiResponse = await polarityRequest.request(requestOptions, options);

  Logger.trace({ apiResponse }, 'Lookup API Response');

  if (
    !SUCCESS_CODES.includes(apiResponse.statusCode) ||
    (apiResponse.body && apiResponse.body.status && apiResponse.body.status !== 'Success')
  ) {
    throw new ApiRequestError(
      `Unexpected status code ${apiResponse.statusCode} received reporting False Positive via ThreatConnect API`,
      {
        statusCode: apiResponse.statusCode,
        requestOptions: apiResponse.requestOptions,
        responseBody: apiResponse.body
      }
    );
  }

  return apiResponse.body.data.falsePositive;
}

module.exports = {
  reportFalsePositive
};
