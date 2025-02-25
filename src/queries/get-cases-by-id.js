const polarityRequest = require('../polarity-request');
const { ApiRequestError } = require('../errors');
const { getLogger } = require('../logger');
const { getIndicatorsById } = require('./get-indicators-by-id');
const SUCCESS_CODES = [200];

async function getCasesById(indicatorIdList, options) {
  const Logger = getLogger();
  const casesById = {};
  const indicatorsList = await getIndicatorsById(indicatorIdList, options);

  const casesIds = Object.values(indicatorsList)
    .flatMap((indicator) => indicator.associatedCases?.data || [])
    .map((caseObj) => caseObj.id);

  const fields = ['artifacts', 'associatedIndicators', 'tags', 'attributes'];
  const requestOptions = {
    uri: `${options.url}/v3/cases`,
    qs: {
      tql: `id in (${casesIds.join(',')})`,
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

  Logger.trace({ apiResponse }, 'getCasesById API Response');

  apiResponse.body.data.forEach((caseObj) => {
    casesById[caseObj.id] = caseObj;
  });

  return casesById;
}

module.exports = {
  getCasesById
};
