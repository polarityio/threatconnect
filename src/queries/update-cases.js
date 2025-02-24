const fp = require('lodash/fp');
const { requestWithDefaults } = require('../polarity-request');

const parseErrorToReadableJson = (error) => JSON.parse(JSON.stringify(error, Object.getOwnPropertyNames(error)));

const updateCases = async (
  { caseId, tags, resolution, description, severity, caseStatus, attributes, artifacts },
  requestWithDefaults,
  options,
  Logger,
  callback
) => {
  try {
    await Promise.all([
      ...(tags ? await updateTags(caseId, tags, options, requestWithDefaults, Logger) : []),
      ...(resolution ? await updateResolution(caseId, resolution, options, requestWithDefaults, Logger) : []),
      ...(description ? await updateDescription(caseId, description, options, requestWithDefaults, Logger) : []),
      ...(severity ? await updateSeverity(caseId, severity, options, requestWithDefaults, Logger) : []),
      ...(caseStatus ? await updateStatus(caseId, caseStatus, options, requestWithDefaults, Logger) : []),
      ...(attributes ? await updateAttributes(caseId, attributes, options, requestWithDefaults, Logger) : []),
      ...(artifacts ? await updateArtifacts(caseId, artifacts, options, requestWithDefaults, Logger) : [])
    ]);
  } catch (error) {
    Logger.error(error, { detail: 'Failed to update case in ThreatConnect' }, 'Case Updating Failed');
    return callback({
      meta: parseErrorToReadableJson(error),
      title: error.message,
      status: error.status,
      detail: 'warning'
    });
  }

  try {
    const updatedCase = await caseObject(caseId, options, requestWithDefaults);
    return callback(null, updatedCase);
  } catch (error) {
    return callback({
      meta: parseErrorToReadableJson(error),
      title: error.message,
      status: error.status,
      detail: 'warning'
    });
  }
};

const caseObject = (caseId, options, requestWithDefaults) =>
  requestWithDefaults({
    path: `/v3/cases/${caseId}?fields=tags&fields=associatedIndicators$fields=attributes&fields=artifacts`,
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });

const updateTags = (caseId, tags, options, requestWithDefaults) =>
  Promise.all(
    fp.flatMap(
      async (tag) =>
        requestWithDefaults({
          path: `/v3/cases/${caseId}`,
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            tags: {
              data: [
                {
                  name: tag
                }
              ]
            }
          },
          options
        }),
      tags
    )
  );

const updateResolution = (caseId, resolution, options, requestWithDefaults) =>
  requestWithDefaults({
    path: `/v3/cases/${caseId}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: { resolution: resolution },
    options
  });

const updateDescription = (caseId, description, options, requestWithDefaults) =>
  requestWithDefaults({
    path: `/v3/cases/${caseId}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: { description: description },
    options
  });

const updateSeverity = (caseId, severity, options, requestWithDefaults) =>
  requestWithDefaults({
    path: `/v3/cases/${caseId}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: { severity: severity },
    options
  });

const updateStatus = (caseId, caseStatus, options, requestWithDefaults) =>
  requestWithDefaults({
    path: `/v3/cases/${caseId}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: { status: caseStatus },
    options
  });

const updateAttributes = (caseId, attributes, options, requestWithDefaults) =>
  Promise.all(
    fp.flatMap(
      async (attribute) =>
        requestWithDefaults({
          path: `/v3/cases/${caseId}`,
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            tags: {
              data: [
                {
                  type: attribute.type,
                  value: attribute.value
                }
              ]
            }
          },
          options
        }),
      attributes
    )
  );

const updateArtifacts = (caseId, artifacts, options, requestWithDefaults) =>
  Promise.all(
    fp.flatMap(
      async (artifact) =>
        requestWithDefaults({
          path: `/v3/cases/${caseId}`,
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            tags: {
              data: [
                {
                  type: artifact.type,
                  summary: artifact.summary
                }
              ]
            }
          },
          options
        }),
      artifacts
    )
  );

module.exports = {
  updateCases,
  updateTags
};
