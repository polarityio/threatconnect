const polarityRequest = require('../polarity-request');
const { ApiRequestError } = require('../errors');
const { getLogger } = require('../logger');
const SUCCESS_CODES = [200];

async function getCasesById(casesIds, options) {
  const Logger = getLogger();

  if (casesIds.length === 0) {
    Logger.trace('No cases found for the given indicators.');
    return { data: [] };
  }

  const fields = ['tags', 'attributes', 'notes'];
  const tql = casesIds.length > 0 ? `id IN (${casesIds.join(',')})` : '';

  const requestOptions = {
    uri: `${options.url}/v3/cases`,
    qs: {
      tql,
      fields,
      sorting: 'dateAdded DESC'
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
      `Unexpected status code ${apiResponse.statusCode} received when fetching Cases details via the ThreatConnect API`,
      {
        statusCode: apiResponse.statusCode,
        requestOptions: apiResponse.requestOptions,
        responseBody: apiResponse.body
      }
    );
  }

  Logger.trace({ apiResponse }, 'getCasesById API Response');

  return apiResponse.body;
}

module.exports = {
  getCasesById
};
