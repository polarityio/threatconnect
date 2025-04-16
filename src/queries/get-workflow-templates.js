const polarityRequest = require('../polarity-request');
const { ApiRequestError } = require('../errors');
const { getLogger } = require('../logger');
const SUCCESS_CODES = [200];

async function getWorkflowTemplates(options) {
  const Logger = getLogger();

  const requestOptions = {
    uri: `${options.url}/v3/workflowTemplates`,
    qs: {
      tql: `active EQ true`
    },
    method: 'GET'
  };

  Logger.trace({ requestOptions }, 'Workflow Templates Request Options');

  const apiResponse = await polarityRequest.request(requestOptions, options);

  if (
    !SUCCESS_CODES.includes(apiResponse.statusCode) ||
    (apiResponse.body && apiResponse.body.status && apiResponse.body.status !== 'Success')
  ) {
    throw new ApiRequestError(
      `Unexpected status code ${apiResponse.statusCode} received when fetching Workflow Templates via the ThreatConnect API`,
      {
        statusCode: apiResponse.statusCode,
        requestOptions: apiResponse.requestOptions,
        responseBody: apiResponse.body
      }
    );
  }

  Logger.trace({ apiResponse }, 'getWorkflowTemplates API Response');

  return apiResponse;
}

module.exports = {
  getWorkflowTemplates
};
