const async = require('async');
const polarityRequest = require('../polarity-request');
const { ApiRequestError } = require('../errors');
const { getLogger } = require('../logger');
const SUCCESS_CODES = [200];

async function getIndicatorsById(
  indicatorIds,
  options,
  fields = ['threatAssess', 'securityLabels', 'tags', 'observations', 'falsePositives']
) {
  const Logger = getLogger();
  const indicatorsById = {};

  const requestOptions = {
    uri: `${options.url}/v3/indicators`,
    qs: {
      tql: `id in (${indicatorIds.join(',')}) and (indicatorActive=false or indicatorActive=true)`,
      fields
    },
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
      `Unexpected status code ${apiResponse.statusCode} received when fetching indicator details via the ThreatConnect API`,
      {
        statusCode: apiResponse.statusCode,
        requestOptions: apiResponse.requestOptions,
        responseBody: apiResponse.body
      }
    );
  }

  Logger.trace({ apiResponse }, 'getIndicatorById API Response');

  apiResponse.body.data.forEach((indicator) => {
    indicatorsById[indicator.id] = indicator;
  });

  return indicatorsById;
}

module.exports = {
  getIndicatorsById
};
