const polarityRequest = require('../polarity-request');
const { ApiRequestError, IntegrationError } = require('../errors');
const { getLogger } = require('../logger');
const SUCCESS_CODES = [200];

/**
 * Used to add or remove tags to an indicator
 *
 * @param indicatorId the id of the indicator
 * @param tagValue the value of the tag
 * @param mode "append" for adding a tag, "delete" for removing a tag
 * @param options user options object
 * @returns {Promise<{}>}
 */
async function updateTag(indicatorId, tagValue, mode, options) {
  if (mode !== 'append' && mode !== 'delete') {
    throw new IntegrationError(`Invalid mode provided to updateTag method.  Supported modes are "append" and "delete"`);
  }

  const Logger = getLogger();

  const requestOptions = {
    uri: `${options.url}/v3/indicators/${indicatorId}`,
    method: 'PUT',
    qs: {
      fields: 'tags'
    },
    body: {}
  };

  requestOptions.body.tags = {
    data: [
      {
        name: tagValue
      }
    ],
    mode
  };

  Logger.trace({ requestOptions }, 'Request Options');

  const apiResponse = await polarityRequest.request(requestOptions, options);

  Logger.trace({ apiResponse }, 'Update Tags API Response');

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

  if (mode === 'delete') {
    return {
      name: tagValue
    }
  } else if (apiResponse.body.data && apiResponse.body.data.tags && Array.isArray(apiResponse.body.data.tags.data)) {
    return apiResponse.body.data.tags;
  }

  Logger.error(`Update Indicator response body does not include the updated tag field value for "${tagValue}"`);
  throw new IntegrationError(`Unexpected response payload from update tags endpoint`, {
    statusCode: apiResponse.statusCode,
    requestOptions: apiResponse.requestOptions,
    responseBody: apiResponse.body
  });
}

module.exports = {
  updateTag
};
