'use strict';

const ipaddr = require('ipaddr.js');
const async = require('async');
const url = require('url');
const ThreatConnect = require('./threatconnect');
const request = require('request');
const fp = require('lodash/fp');
const fs = require('fs');
const config = require('./config/config');
const MAX_SUMMARY_TAGS = 3;

let tc;
let Logger;

function startup(logger) {
  Logger = logger;

  let defaults = {};

  if (typeof config.request.cert === 'string' && config.request.cert.length > 0) {
    defaults.cert = fs.readFileSync(config.request.cert);
  }

  if (typeof config.request.key === 'string' && config.request.key.length > 0) {
    defaults.key = fs.readFileSync(config.request.key);
  }

  if (typeof config.request.passphrase === 'string' && config.request.passphrase.length > 0) {
    defaults.passphrase = config.request.passphrase;
  }

  if (typeof config.request.ca === 'string' && config.request.ca.length > 0) {
    defaults.ca = fs.readFileSync(config.request.ca);
  }

  if (typeof config.request.proxy === 'string' && config.request.proxy.length > 0) {
    defaults.proxy = config.request.proxy;
  }

  if (typeof config.request.rejectUnauthorized === 'boolean') {
    defaults.rejectUnauthorized = config.request.rejectUnauthorized;
  }

  tc = new ThreatConnect(request.defaults(defaults), Logger);
}

function doLookup(entities, options, cb) {
  tc.setSecretKey(options.apiKey);
  tc.setHost(options.url);
  tc.setAccessId(options.accessId);

  Logger.trace({ entities: entities, options }, 'doLookup');
  searchAllOwners(entities, options, (err, lookupResults) => {
    cb(err, lookupResults);
  });
}

function createSearchOrgAllowlist(options) {
  let allowlistedOrgs = new Set();

  if (typeof options.searchAllowlist === 'string' && options.searchAllowlist.trim().length > 0) {
    let tokens = options.searchAllowlist.split(',');
    tokens.forEach((token) => {
      token = token.trim().toLowerCase();
      if (token.length > 0) {
        allowlistedOrgs.add(token);
      }
    });
  }

  Logger.debug({ allowlist: [...allowlistedOrgs] }, 'Organization Search Allowlist');

  return allowlistedOrgs;
}

function createSearchOrgBlocklist(options) {
  let blocklistedOrgs = new Set();

  if (typeof options.searchBlocklist === 'string' && options.searchBlocklist.trim().length > 0) {
    let tokens = options.searchBlocklist.split(',');
    tokens.forEach((token) => {
      token = token.trim().toLowerCase();
      if (token.length > 0) {
        blocklistedOrgs.add(token);
      }
    });
  }

  Logger.debug({ blocklist: [...blocklistedOrgs] }, 'Organization Search Blocklist');

  return blocklistedOrgs;
}

function getFilteredOwners(owners, options) {
  if (options.searchBlocklist.trim().length > 0) {
    let blocklistedOrgs = createSearchOrgBlocklist(options);
    return owners.filter((owner) => {
      return !blocklistedOrgs.has(owner.name.toLowerCase());
    });
  } else if (options.searchAllowlist.trim().length > 0) {
    let allowlistedOrgs = createSearchOrgAllowlist(options);
    return owners.filter((owner) => {
      return allowlistedOrgs.has(owner.name.toLowerCase());
    });
  } else {
    return owners;
  }
}

function searchAllOwners(entities, options, cb) {
  let lookupResults = [];

  async.each(
    entities,
    (entityObj, next) => {
      let lookupValue = _getSanitizedEntity(entityObj);
      if (lookupValue !== null) {
        tc.getOwners(convertPolarityTypeToThreatConnect(entityObj.type), lookupValue, (err, result) => {
          if (err) {
            return cb(err);
          }

          if (result.owners.length === 0) {
            if (options.createNewIndicators) {
              lookupResults.push({
                entity: entityObj,
                isVolatile: true,
                data: { summary: ['New Entity'] }
              });
            } else {
              lookupResults.push({
                entity: entityObj,
                data: null
              });
            }
          } else {
            const filteredOwners = getFilteredOwners(result.owners, options);
            if (filteredOwners.length > 0) {
              lookupResults.push({
                entity: entityObj,
                data: {
                  summary: _getOwnerSummaryTags(filteredOwners),
                  details: {
                    meta: result.meta,
                    owners: filteredOwners
                  }
                }
              });
            }
          }
          next();
        });
      } else {
        // We attempted to lookup an invalid entity (improperly formatted IPv6)
        lookupResults.push({
          entity: entityObj,
          data: null
        });

        next();
      }
    },
    (err) => {
      cb(err, lookupResults);
    }
  );
}

function _getOwnerSummaryTags(owners) {
  let tags = [];

  for (let i = 0; i < owners.length && i < MAX_SUMMARY_TAGS; i++) {
    tags.push(`${_getOwnerIcon()} ${owners[i].name}`);
  }
  if (owners.length > tags.length) {
    tags.push(`+${owners.length - tags.length}`);
  }

  return tags;
}

/**
 * When looking up indicators in ThreatConnect the "type" of the indicator must be provided.  This method converts
 * the type as specified in Polarity's entity object into the appropriate ThreatConnect type.
 * @param type
 * @returns {string}
 */
function convertPolarityTypeToThreatConnect(type) {
  switch (type) {
    case 'IPv4':
      return 'addresses';
    case 'IPv6':
      return 'addresses';
    case 'hash':
      return 'files';
    case 'email':
      return 'emailAddresses';
    case 'domain':
      return 'hosts';
  }
}

const INDICATOR_TYPES = {
  files: 'file',
  emailAddresses: 'emailAddress',
  hosts: 'host',
  addresses: 'address'
};

/**
 * ThreatConnect has limited support for IPv6 formats.  This method converts the value of the provided entityObj
 * into a valid value for ThreatConnect.  If a conversion cannot be done, the method returns null.
 * @param entityObj
 * @returns {*}
 * @private
 */
function _getSanitizedEntity(entityObj) {
  let lookupValue = entityObj.value;

  if (entityObj.isIPv4 || entityObj.isIPv6) {
    // TC does not recognize fully expanded IPv6 addresses
    // TC does not recognize leading zeroes in IPv6 address octets
    // TC does not recognize IPv6 addresses unless they are lowercase
    // TC does not recognize IPv6 addresses if they use the "compressed" :: form for zeroes
    if (entityObj.isIPv6) {
      if (ipaddr.isValid(lookupValue)) {
        // convert the IPv6 address into a format TC understands
        lookupValue = ipaddr.parse(lookupValue).toNormalizedString();
      } else {
        // Integration Received an invalid IPv6 address
        Logger.warn(`Unsupported IPv6 address format ignored: [${entityObj.value}]`);
        lookupValue = null;
      }
    }
  }
  Logger.info(lookupValue);

  return lookupValue;
}

function onDetails(lookupObject, options, cb) {
  Logger.debug({ lookupObject, options }, 'onDetails Input');

  const details = fp.get('data.details', lookupObject);
  const tasks = [];
  
  tc.setSecretKey(options.apiKey);
  tc.setHost(options.url);
  tc.setAccessId(options.accessId);

  if (!details) {
    return tc.getPlaybooks((err, playbooks) => {
      if (err) return cb(err);

      cb(null, {
        ...lookupObject,
        isVolatile: true,
        summary: ['New Entity'],
        details: {
          indicatorType: INDICATOR_TYPES[convertPolarityTypeToThreatConnect(fp.get('entity.type', lookupObject))],
          playbooks
        }
      });
    });
  }

  if (!details.meta || !Array.isArray(details.owners)) {
    // invalid data probably due to cached entry
    Logger.warn(
      'Malformed onDetails lookupObject org.  This can occur if a cached entry from an older version of the ThreatConnect integration is received'
    );

    return cb({
      debug: {
        lookupObject: lookupObject,
        msg:
          'Malformed onDetails lookupObject org.  This can occur if a cached entry from an older version of the ThreatConnect integration is received'
      },
      detail: 'Malformed lookupObject received in onDetails hook. Object is missing `meta` or `owner` properties.'
    });
  }

  const owners = details.owners;
  const indicatorType = details.meta.indicatorType;
  const indicatorValue = details.meta.indicatorValue;

  owners.forEach((owner) => {
    tasks.push(function(done) {
      async.parallel(
        {
          getIndicator: (subTaskDone) => tc.getIndicator(indicatorType, indicatorValue, owner.name, subTaskDone),
          getGroupAssociations: (subTaskDone) =>
            tc.getGroupAssociations(indicatorType, indicatorValue, owner.name, subTaskDone),
          getIndicatorAssociations: (subTaskDone) =>
            tc.getIndicatorAssociations(indicatorType, indicatorValue, owner.name, subTaskDone)
        },
        (err, results) => {
          done(err, results);
        }
      );
    });
  });

  async.parallel(tasks, (err, results) => {
    if (err) {
      Logger.error({ err: err }, 'Error in onDetails lookup');
      cb(err);
    } 
    
    Logger.debug({ results }, 'onDetails Results');

    let orgData = fp.map(
      (result) => {
        const groups = fp.getOr([], 'getGroupAssociations.groups', result);
        const indicators = fp.getOr([], 'getIndicatorAssociations.indicators', result);
        const numAssociations = groups.length + indicators.length;
        const getIndicator = { ...result.getIndicator, groups, indicators, numAssociations };

        result.getIndicator = getIndicator;

        return getIndicator;
      },
      results
    );
    
    orgData.forEach((org) => {
      _modifyWebLinksWithPort(org); //this method mutates result
      if (org.threatAssessScore) {
        org.threatAssessScorePercentage = (org.threatAssessScore / 1000) * 100;
      } else {
        org.threatAssessScorePercentage = 0;
      }
    });

    Logger.debug({ orgData }, 'Final Result');

    cb(null, {
      summary: lookupObject.data.summary,
      isVolatile: true,
      details: {
        ...fp.getOr({}, 'data.details', lookupObject),
        results: orgData,
      }
    });
    
  });
}

function onMessage(payload, options, cb) {
  Logger.debug({ payload }, 'Received onMessage');
  tc.setSecretKey(options.apiKey);
  tc.setHost(options.url);
  tc.setAccessId(options.accessId);

  switch (payload.action) {
    case 'SET_RATING':
      tc.setRating(
        payload.data.indicatorValue,
        payload.data.indicatorType,
        payload.data.owner,
        payload.data.rating,
        function (err, result) {
          if (err) {
            Logger.error({ err, payload }, 'Error Setting Rating');
            cb(null, { error: err });
          } else {
            Logger.debug({ result: result }, 'Returning SET_RATING');
            cb(null, { data: result });
          }
        }
      );
      break;
    case 'SET_CONFIDENCE':
      tc.setConfidence(
        payload.data.indicatorValue,
        payload.data.indicatorType,
        payload.data.owner,
        payload.data.confidence,
        function (err, result) {
          if (err) {
            Logger.error({ err, payload }, 'Error Setting Rating');
            cb(null, { error: err });
          } else {
            Logger.debug({ result: result }, 'Returning SET_CONFIDENCE');
            cb(null, { data: result });
          }
        }
      );
      break;
    case 'REPORT_FALSE_POSITIVE':
      tc.reportFalsePositive(
        payload.data.indicatorType,
        payload.data.indicatorValue,
        payload.data.owner,
        (err, result) => {
          if (err) {
            Logger.error({ err, payload }, 'Error Reporting False Positive');
            cb(null, { error: err });
          } else {
            Logger.debug({ result: result }, 'Returning REPORT_FALSE_POSITIVE');
            cb(null, { data: result });
          }
        }
      );
      break;
    case 'DELETE_TAG':
      tc.deleteTag(
        payload.data.indicatorType,
        payload.data.indicatorValue,
        payload.data.tag,
        payload.data.owner,
        (err) => {
          if (err) {
            Logger.error({ err, payload }, 'Error Deleting Tag');
            cb(null, { error: err });
          } else {
            Logger.debug('Returning DELETE_TAG');
            cb(null, {});
          }
        }
      );
      break;
    case 'ADD_TAG':
      tc.addTag(
        payload.data.indicatorType,
        payload.data.indicatorValue,
        payload.data.tag,
        payload.data.owner,
        (err, result) => {
          if (err) {
            Logger.error({ err, payload }, 'Error Adding Tag');
            cb(null, { error: err });
          } else {
            Logger.debug({ result }, 'Returning ADD_TAG');
            result.link = _addPortToLink(result.link, config.settings.threatConnectPort);
            // result contains a property called link which is the link to the new tag
            cb(null, { data: result });
          }
        }
      );
      break;
    case 'CREATE_INDICATOR':
      createIndicator(payload.data.entity, options, (err, result) => {
        if (err) {
          Logger.error({ err, payload }, 'Error Running Playbook');
          cb({
            errors: [
              {
                detail: 'Error Creating Entity and Running Playbook',
                err
              }
            ]
          });
        }
        Logger.trace({ test: 'Create Indicator Result', result });
        cb(null, result);
      });
      
      break;
    default:
      cb({
        detail: "Invalid 'action' provided to onMessage function"
      });
  }
}

/**
 * Mutates the provided `result` object by modifying the webLink properties to include a port.  This is required
 * because the TC REST API does not return proper webLinks when you are running an on-prem TC instance on a port that
 * is not 443.
 *
 * @param result
 * @private
 */
function _modifyWebLinksWithPort(result) {
  if (config.settings.threatConnectPort !== null) {
    const port = config.settings.threatConnectPort;

    if (typeof result.webLink === 'string') {
      result.webLink = _addPortToLink(result.webLink, port);
    }

    if (Array.isArray(result.tag)) {
      result.tag.forEach((tag) => {
        if (typeof tag.webLink === 'string') {
          tag.webLink = _addPortToLink(tag.webLink, port);
        }
      });
    }

    if (Array.isArray(result.groups)) {
      result.groups.forEach((group) => {
        if (typeof group.webLink === 'string') {
          group.webLink = _addPortToLink(group.webLink, port);
        }
      });
    }

    if (Array.isArray(result.indicators)) {
      result.indicators.forEach((indicator) => {
        if (typeof indicator.webLink === 'string') {
          indicator.webLink = _addPortToLink(indicator.webLink, port);
        }
      });
    }
  }
}
function _addPortToLink(weblinkToTransform, port) {
  let weblinkAsUrl = url.parse(weblinkToTransform);
  weblinkAsUrl.port = port;
  delete weblinkAsUrl.host;
  //Logger.info({url: url.format(weblinkAsUrl), port: weblinkAsUrl.port}, 'WebLink');
  return url.format(weblinkAsUrl);
}

function _getOwnerIcon() {
  return `<svg viewBox="0 0 448 512" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true" data-icon="building" data-prefix="fas" id="ember1223" class="svg-inline--fa fa-building fa-w-14  ember-view"><path fill="currentColor" d="M436 480h-20V24c0-13.255-10.745-24-24-24H56C42.745 0 32 10.745 32 24v456H12c-6.627 0-12 5.373-12 12v20h448v-20c0-6.627-5.373-12-12-12zM128 76c0-6.627 5.373-12 12-12h40c6.627 0 12 5.373 12 12v40c0 6.627-5.373 12-12 12h-40c-6.627 0-12-5.373-12-12V76zm0 96c0-6.627 5.373-12 12-12h40c6.627 0 12 5.373 12 12v40c0 6.627-5.373 12-12 12h-40c-6.627 0-12-5.373-12-12v-40zm52 148h-40c-6.627 0-12-5.373-12-12v-40c0-6.627 5.373-12 12-12h40c6.627 0 12 5.373 12 12v40c0 6.627-5.373 12-12 12zm76 160h-64v-84c0-6.627 5.373-12 12-12h40c6.627 0 12 5.373 12 12v84zm64-172c0 6.627-5.373 12-12 12h-40c-6.627 0-12-5.373-12-12v-40c0-6.627 5.373-12 12-12h40c6.627 0 12 5.373 12 12v40zm0-96c0 6.627-5.373 12-12 12h-40c-6.627 0-12-5.373-12-12v-40c0-6.627 5.373-12 12-12h40c6.627 0 12 5.373 12 12v40zm0-96c0 6.627-5.373 12-12 12h-40c-6.627 0-12-5.373-12-12V76c0-6.627 5.373-12 12-12h40c6.627 0 12 5.373 12 12v40z"></path></svg> `;
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

function createIndicator(entity, options, callback) {
  tc.createIndicator(entity, (err, indicatorId) => {
    if (err) return callback(err);
    doLookup([entity], options, (err, [lookupResult]) => {
      if (err) return callback(err);
      onDetails(lookupResult, options, (err, lookupObject) => {
        if (err) return callback(err);

        callback(null, lookupObject);
      });
    });
  });
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
  doLookup: doLookup,
  startup: startup,
  onMessage: onMessage,
  onDetails: onDetails,
  validateOptions: validateOptions
};
