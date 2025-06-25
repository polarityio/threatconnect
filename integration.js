'use strict';

const async = require('async');

const _ = require('lodash');
const { setLogger } = require('./src/logger');
const { createResultObjects } = require('./src/create-result-object');
const { searchIndicator } = require('./src/queries/search-indicator');
const { updateIndicator } = require('./src/queries/update-indicator');
const { getIndicatorsById } = require('./src/queries/get-indicators-by-id');
const { reportFalsePositive } = require('./src/queries/report-false-positive');
const { updateTag } = require('./src/queries/update-tag');
const { filterInvalidEntities } = require('./src/tc-request-utils');
const { getTokenOwner } = require('./src/queries/get-token-owner');
const { getCasesById } = require('./src/queries/get-cases-by-id');
const { updateCaseTags } = require('./src/queries/update-cases');
const { updateCase } = require('./src/queries/update-cases');
const { createCase } = require('./src/queries/create-case');
const { getWorkflowTemplates } = require('./src/queries/get-workflow-templates');

const MAX_TASKS_AT_A_TIME = 2;
const VALID_UPDATE_FIELDS = ['rating', 'confidence', 'tags'];
const VALID_FETCH_FIELDS = ['associatedCases', 'associatedIndicators', 'associatedGroups', 'whois', 'dnsResolution'];

const tokenOwners = {};

let Logger = null;

function startup(logger) {
  Logger = logger;
  setLogger(Logger);
}

/**
 * Iterates over the provided entity objects and checks if the `type` property
 * is set to "string".  If it is, modifies the "type" property to be the first valid
 * specific type found in the `types` property.  Valid specific types are
 * "hash", "IPv4", "IPv6", "email", "domain", "url".  This method mutates the provided
 * entities array.
 *
 * Note: This method is a temporary fix for PL-1017 and can be removed once that fix
 * is deployed.
 * @param entities - array of entity objects
 */
function fixEntityType(entities) {
  const validTypes = ['hash', 'IPv4', 'IPv6', 'email', 'domain', 'url'];

  entities.forEach((entity) => {
    if (typeof entity.type === 'string') {
      const specificType = entity.types.find((type) => validTypes.includes(type));
      if (specificType) {
        entity.type = specificType;
      }
    }
  });
}

async function doLookup(entities, options, cb) {
  fixEntityType(entities);

  Logger.trace({ entities }, 'doLookup');

  let lookupResults = [];
  const tasks = [];

  const filteredEntities = filterInvalidEntities(entities);

  // If not token owner could be determined the value here will be `null`
  const tokenOwner = await getCachedTokenOwner(options);

  filteredEntities.forEach((entity) => {
    tasks.push(async () => {
      const indicators = await searchIndicator(entity, options);
      const ownerResultObjects = createResultObjects(entity, indicators, tokenOwner, options);
      lookupResults = lookupResults.concat(ownerResultObjects);
    });
  });

  try {
    await async.parallelLimit(tasks, MAX_TASKS_AT_A_TIME);
  } catch (error) {
    Logger.error({ error }, 'Error in doLookup');
    return cb(error);
  }

  Logger.trace({ lookupResults }, 'Lookup Results');
  cb(null, lookupResults);
}

async function getCachedTokenOwner(options) {
  if (tokenOwners[options.accessId]) {
    return tokenOwners[options.accessId];
  }

  const tokenOwner = await getTokenOwner(options);
  tokenOwners[options.accessId] = tokenOwner;

  return tokenOwner;
}

async function onDetails(resultObject, options, cb) {
  try {
    const indicatorIdList = Object.keys(resultObject.data.details.indicators);
    const indicatorsById = await getIndicatorsById(indicatorIdList, options);
    for (const indicatorId in indicatorsById) {
      const indicatorDetails = indicatorsById[indicatorId];
      resultObject.data.details.indicators[indicatorId].indicator = indicatorDetails;
    }

    Logger.trace({ resultObject, indicatorsById }, 'onDetails Result');

    cb(null, resultObject.data);
  } catch (error) {
    cb(error);
  }
}

async function onMessage(payload, options, cb) {
  Logger.trace({ payload }, 'onMessage received');
  switch (payload.action) {
    case 'GET_INDICATOR_FIELD':
      if (!VALID_FETCH_FIELDS.includes(payload.field)) {
        return cb(null, {
          error: {
            detail: `The field ${payload.field} is not an allowed field for fetching`
          }
        });
      }

      try {
        const response = await getIndicatorsById([payload.indicatorId], options, [payload.field]);
        // dnsResolution requires special handling because it includes "empty" records which we don't want to display
        // in the template.  We remove them server side so that local paging on the client works.
        if (payload.field === 'dnsResolution') {
          let dns = _.get(response, `${payload.indicatorId}.dnsResolution.data`, []);
          if (dns.length > 0) {
            response[payload.indicatorId].dnsResolution.data = dns.filter(
              (dns) => typeof dns.addresses !== 'undefined'
            );
          }
        }
        if (payload.field === 'associatedCases') {
          const casesIds = Object.values(response)
            .flatMap((indicator) => (indicator.associatedCases?.data || []).map((caseObj) => caseObj.id))
            .filter(Boolean);

          const apiResponse = await getCasesById(casesIds, options);

          const casesByIndicator = {};

          Object.entries(response).forEach(([indicatorId, indicator]) => {
            casesByIndicator[indicatorId] = {
              indicatorId: parseInt(indicatorId, 10),
              ownerName: indicator.ownerName,
              associatedCases: {
                data: []
              }
            };
          });

          apiResponse.data.forEach((caseObj) => {
            Object.entries(response).forEach(([indicatorId, indicator]) => {
              const associatedCases = indicator.associatedCases?.data || [];

              if (associatedCases.some((c) => c.id === caseObj.id)) {
                casesByIndicator[indicatorId].associatedCases.data.push({
                  ...caseObj,
                  indicatorId: parseInt(indicatorId, 10),
                  ownerName: indicator.ownerName
                });
              }
            });
          });

          response[payload.indicatorId].associatedCases = casesByIndicator[payload.indicatorId].associatedCases;
        }

        cb(null, {
          data: response[payload.indicatorId]
        });
      } catch (error) {
        cb(null, {
          error
        });
      }

      break;
    case 'UPDATE_INDICATOR':
      if (VALID_UPDATE_FIELDS.includes(payload.field)) {
        try {
          const updatedField = await updateIndicator(payload.indicatorId, payload.field, payload.value, options);
          cb(null, {
            data: updatedField
          });
        } catch (error) {
          cb(null, {
            error
          });
        }
      } else {
        //invalid update field attempted
        cb(null, {
          error: {
            detail: `The field ${payload.field} is not an allowed field for updating`
          }
        });
      }

      break;
    case 'REPORT_FALSE_POSITIVE':
      try {
        const response = await reportFalsePositive(payload.entity, payload.owner, options);
        cb(null, {
          data: response
        });
      } catch (error) {
        cb(null, {
          error
        });
      }
      break;
    case 'UPDATE_TAG':
      try {
        const response = await updateTag(payload.indicatorId, payload.tag, payload.mode, options);
        cb(null, {
          data: response
        });
      } catch (error) {
        cb(null, {
          error
        });
      }
      break;
    case 'UPDATE_CASE_TAG':
      try {
        const response = await updateCaseTags(payload.caseId, payload.tag, payload.mode, options);
        cb(null, {
          data: response
        });
      } catch (error) {
        cb(null, {
          error
        });
      }
      break;
    case 'UPDATE_CASE':
      try {
        if (!options.enableEditingCases) {
          return cb(null, {
            error: {
              detail: 'Editing cases is disabled.'
            }
          });
        }
        const response = await updateCase(payload, options);
        cb(null, {
          data: response
        });
      } catch (error) {
        cb(null, {
          error
        });
      }
      break;
    case 'CREATE_CASE':
      try {
        if (!options.enableEditingCases) {
          return cb(null, {
            error: {
              detail: 'Creating cases is disabled.'
            }
          });
        }
        const response = await createCase(payload, options);
        cb(null, {
          data: response
        });
      } catch (error) {
        Logger.error({ error }, 'Error creating case');
        cb(null, {
          error: {
            detail: 'Error creating case',
            error
          }
        });
      }
      break;
    case 'GET_WORKFLOW_TEMPLATES':
      try {
        const workflowTemplates = await getWorkflowTemplates(options);
        cb(null, {
          workflowTemplates
        });
      } catch (error) {
        cb(error, {
          error: {
            detail: 'Error fetching workflow templates',
            error
          }
        });
      }
      break;
  }
}

function isOptionMissing(userOptions, key) {
  if (
    typeof userOptions[key].value !== 'string' ||
    (typeof userOptions[key].value === 'string' && userOptions[key].value.length === 0)
  ) {
    return true;
  }
  return false;
}

function validateOptions(userOptions, cb) {
  let errors = [];

  if (isOptionMissing(userOptions, 'url')) {
    errors.push({
      key: 'url',
      message: 'You must provide a valid ThreatConnect Instance URL'
    });
  }

  if (isOptionMissing(userOptions, 'accessId')) {
    errors.push({
      key: 'accessId',
      message: 'You must provide a valid Access ID'
    });
  }

  if (isOptionMissing(userOptions, 'apiKey')) {
    errors.push({
      key: 'apiKey',
      message: 'You must provide a valid API Key'
    });
  }

  if (
    typeof userOptions.searchAllowlist.value === 'string' &&
    userOptions.searchAllowlist.value.trim().length > 0 &&
    typeof userOptions.searchBlocklist.value === 'string' &&
    userOptions.searchBlocklist.value.trim().length > 0
  ) {
    errors.push({
      key: 'searchAllowlist',
      message: 'You cannot provide both an "Organization Search Allowlist", and an "Organization Search Blocklist".'
    });
    errors.push({
      key: 'searchBlocklist',
      message: 'You cannot provide both an "Organization Search Blocklist", and an "Organization Search Allowlist".'
    });
  }

  cb(null, errors);
}

module.exports = {
  startup,
  doLookup,
  onMessage,
  onDetails,
  validateOptions
};
