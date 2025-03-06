const polarityRequest = require('../polarity-request');
const { ApiRequestError, IntegrationError } = require('../errors');
const { getLogger } = require('../logger');
const SUCCESS_CODES = [200];

/**
 * Used to add or remove tags to an indicator
 *
 * @param caseId the id of the indicator
 * @param tag the value of the tag
 * @param mode "append" for adding a tag, "delete" for removing a tag
 * @param options user options object
 * @returns {Promise<{}>}
 */
async function updateCaseTags(caseId, tag, mode, options) {
  if (mode !== 'append' && mode !== 'delete') {
    throw new IntegrationError(`Invalid mode provided to updateTag method. Supported modes are "append" and "delete"`);
  }
  const Logger = getLogger();

  const requestOptions = {
    uri: `${options.url}/v3/cases/${caseId}`,
    method: 'PUT',
    qs: {
      fields: 'tags'
    },
    body: {}
  };

  requestOptions.body.tags = {
    data: [
      {
        name: tag
      }
    ],
    mode
  };

  Logger.trace({ requestOptions }, 'Request Options');

  const apiResponse = await polarityRequest.request(requestOptions, options);

  Logger.trace({ apiResponse }, 'Update Case Tags API Response');

  if (SUCCESS_CODES.includes(apiResponse.statusCode) && apiResponse.body && apiResponse.body.status === 'Success') {
    return apiResponse.body.data;
  } else if (
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
}

/**
 * Used to add or remove tags to an indicator
 *
 * @param payload
 * @param options user options object
 * @returns {Promise<{}>}
 */
async function updateCase(payload, options) {
  if (payload.mode !== 'append' && payload.mode !== 'delete') {
    throw new IntegrationError(`Invalid mode provided to updateCase method. Supported modes are "append" and "delete"`);
  }
  const Logger = getLogger();

  const requestOptions = {
    uri: `${options.url}/v3/cases/${payload.caseId}`,
    method: 'PUT',
    body: {}
  };

  const status = payload.status;
  if (status && status !== 'undefined') {
    requestOptions.body = {
      status: status
    };
  }

  const severity = payload.severity;
  if (severity && severity !== 'undefined') {
    requestOptions.body = {
      severity: severity
    };
  }

  const resolution = payload.resolution;
  if (resolution && resolution !== 'undefined') {
    requestOptions.body = {
      resolution: resolution
    };
  }

  const description = payload.description;
  if (description && description !== 'undefined') {
    requestOptions.body = {
      description: description
    };
  }

  Logger.trace({ requestOptions }, 'Request Options');

  const apiResponse = await polarityRequest.request(requestOptions, options);

  Logger.trace({ apiResponse }, 'Update Case API Response');

  if (SUCCESS_CODES.includes(apiResponse.statusCode) && apiResponse.body && apiResponse.body.status === 'Success') {
    return apiResponse.body.data;
  } else if (
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
}

module.exports = {
  updateCaseTags,
  updateCase
};
