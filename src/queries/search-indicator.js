const polarityRequest = require('../polarity-request');
const { ApiRequestError } = require('../errors');
const { getLogger } = require('../logger');
const { convertPolarityTypeToThreatConnectSingular } = require('../tc-request-utils');
const SUCCESS_CODES = [200];

async function searchIndicator(entity, options, fields = []) {
  const Logger = getLogger();

  const requestOptions = {
    uri: `${options.url}/v3/indicators`,
    qs: {
      tql: createTqlQuery(entity, options)
    },
    method: 'GET',
    useQuerystring: true
  };

  if (fields.length > 0) {
    requestOptions.qs.fields = fields;
  }

  Logger.trace({ requestOptions }, 'Request Options');

  const apiResponse = await polarityRequest.request(requestOptions, options);

  Logger.trace({ apiResponse }, 'Search API Response');

  if (
    !SUCCESS_CODES.includes(apiResponse.statusCode) ||
    (apiResponse.body && apiResponse.body.status && apiResponse.body.status !== 'Success')
  ) {
    throw new ApiRequestError(
      `Unexpected status code ${apiResponse.statusCode} received when making search request to the ThreatConnect API`,
      {
        statusCode: apiResponse.statusCode,
        requestOptions: apiResponse.requestOptions,
        responseBody: apiResponse.body
      }
    );
  }

  return apiResponse.body;
}

function createTqlQuery(entity, options) {
  const indicatorType = convertPolarityTypeToThreatConnectSingular(entity.type);
  let query = `summary="${entity.value}" and typeName="${indicatorType}"`;

  if (options.searchInactiveIndicators) {
    query += ` and (indicatorActive=true or indicatorActive=false)`;
  }

  if (typeof options.searchAllowlist === 'string' && options.searchAllowlist.trim().length > 0) {
    query += ` and ownerName in (`;
    options.searchAllowlist.split(',').forEach((org, index) => {
      index === 0 ? (query += `"${org}"`) : (query += `",${org}"`);
    });
    query += ')';
  } else if (typeof options.searchBlocklist === 'string' && options.searchBlocklist.trim().length > 0) {
    query += ` and ownerName not in (`;
    options.searchBlocklist.split(',').forEach((org, index) => {
      index === 0 ? (query += `"${org}"`) : (query += `",${org}"`);
    });
    query += ')';
  }
  return query;
}

module.exports = {
  searchIndicator
};
