const polarityRequest = require('../polarity-request');
const { ApiRequestError } = require('../errors');
const { getLogger } = require('../logger');
const SUCCESS_CODES = [201];

async function createCase(payload, options) {
  const Logger = getLogger();

  const fields = ['tags', 'attributes', 'notes'];

  const requestOptions = {
    uri: `${options.url}/v3/cases`,
    qs: { fields },
    method: 'POST',
    body: {},
    useQuerystring: true
  };

  const name = payload.name;
  if (name && name !== 'undefined') {
    requestOptions.body.name = name;
  }

  const workflowTemplateId = parseInt(payload.workflowTemplateId, 10);
  if (!Number.isNaN(workflowTemplateId)) {
    requestOptions.body.workflowTemplate = { id: workflowTemplateId };
  }

  const description = payload.description;
  if (description && description !== 'undefined') {
    requestOptions.body.description = description;
  }

  const tags = payload.tags;
  if (tags && tags !== 'undefined') {
    requestOptions.body.tags = { data: [{ name: tags }] };
  }

  const severity = payload.severity;
  if (severity && severity !== 'undefined') {
    requestOptions.body.severity = severity;
  }

  const status = payload.status;
  if (status && status !== 'undefined') {
    requestOptions.body.status = status;
  }

  const notes = payload.notes;
  if (notes && notes !== 'undefined') {
    requestOptions.body.notes = { data: [{ text: notes }] };
  }

  const associateIndicator = payload.associateIndicator;
  if (associateIndicator && associateIndicator !== 'undefined') {
    requestOptions.body.associatedIndicators = { data: [{ id: payload.indicatorId }] };
  }

  Logger.trace({ requestOptions }, 'Request Options');

  const apiResponse = await polarityRequest.request(requestOptions, options);

  Logger.trace({ apiResponse }, 'Create Case API Response');

  if (
    !SUCCESS_CODES.includes(apiResponse.statusCode) ||
    (apiResponse.body && apiResponse.body.status && apiResponse.body.status !== 'Success')
  ) {
    throw new ApiRequestError(
      `Unexpected status code ${apiResponse.statusCode} received while creating case via ThreatConnect API`,
      {
        statusCode: apiResponse.statusCode,
        requestOptions: apiResponse.requestOptions,
        responseBody: apiResponse.body
      }
    );
  }

  return apiResponse.body.data;
}

module.exports = {
  createCase
};
