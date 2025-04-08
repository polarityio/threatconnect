const polarityRequest = require('../polarity-request');
const { ApiRequestError } = require('../errors');
const { getLogger } = require('../logger');
const { getIndicatorsById } = require('./get-indicators-by-id');
const SUCCESS_CODES = [200];

async function getCasesById(indicatorIdList, options) {
  const Logger = getLogger();
  const casesByIndicator = {};
  const indicatorsListResponse = await getIndicatorsById(indicatorIdList, options);

  const casesIds = Object.values(indicatorsListResponse)
    .flatMap((indicator) => (indicator.associatedCases?.data || []).map((caseObj) => caseObj.id))
    .filter((id) => id !== undefined);

  if (casesIds.length === 0) {
    Logger.trace('No cases found for the given indicators.');
    return {};
  }

  const fields = ['tags', 'attributes'];
  const requestOptions = {
    uri: `${options.url}/v3/cases`,
    qs: {
      tql: `id in (${casesIds.join(',')})`,
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

  Object.entries(indicatorsListResponse).forEach(([indicatorId, indicator]) => {
    casesByIndicator[indicatorId] = {
      indicatorId: parseInt(indicatorId, 10),
      ownerName: indicator.ownerName,
      associatedCases: {}
    };
  });

  apiResponse.body.data.forEach((caseObj) => {
    Object.entries(indicatorsListResponse).forEach(([indicatorId, indicator]) => {
      const associatedCases = indicator.associatedCases?.data || [];

      // If the case ID is listed under the indicator, add it
      if (associatedCases.some((c) => c.id === caseObj.id)) {
        casesByIndicator[indicatorId].associatedCases[caseObj.id] = {
          ...caseObj,
          indicatorId: parseInt(indicatorId, 10),
          ownerName: indicator.ownerName
        };
      }
    });
  });

  return casesByIndicator;
}

module.exports = {
  getCasesById
};
