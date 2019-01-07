'use strict';

const ipaddr = require('ipaddr.js');
const async = require('async');
const url = require('url');
const ThreatConnect = require('./threatconnect');
const request = require('request');
const fs = require('fs');
const config = require('./config/config');
const MAX_SUMMARY_TAGS = 6;

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

  tc = new ThreatConnect(request.defaults(defaults), Logger);
}

function doLookup(entities, options, cb) {
  let lookupResults = [];

  tc.setSecretKey(options.apiKey);
  tc.setHost(options.url);
  tc.setAccessId(options.accessId);

  Logger.trace({ entities: entities }, 'doLookup');

  let organizations = [];

  if (typeof options.defaultOrganizations === 'string' && options.defaultOrganizations.trim().length > 0) {
    let tokens = options.defaultOrganizations.split(',');
    tokens.forEach((token) => {
      token = token.trim();
      if (token.length > 0) {
        organizations.push(token);
      }
    });
  } else {
    organizations.push('');
  }

  Logger.debug({ organizations: organizations });

  async.each(
    entities,
    function(entityObj, next) {
      _lookupEntity(entityObj, organizations, options, function(err, entityResults) {
        if (err) {
          next(err);
          return;
        }

        lookupResults.push(entityResults);
        next(null);
      });
    },
    function(err) {
      Logger.debug({ lookupResults }, 'Lookup Results');
      cb(err, lookupResults);
    }
  );
}

function _lookupEntity(entityObj, organizations, options, cb) {
  let orgResults = {
    entity: entityObj,
    data: {
      summary: [],
      details: []
    }
  };

  async.each(
    organizations,
    function(org, next) {
      _lookupOrg(entityObj, org, options, function(err, data) {
        if (err) {
          next(err);
          return;
        }

        if (data) {
          Logger.debug({ data }, 'Tag Information');
          _getSummaryTags(data).forEach(function(tag) {
            orgResults.data.summary.push(tag);
          });

          orgResults.data.details.push(data);
        }

        next(null);
      });
    },
    function(err) {
      if (orgResults.data.details.length === 0) {
        cb(err, { entity: entityObj, data: null });
      } else {
        cb(err, orgResults);
      }
    }
  );
}

function _lookupOrg(entityObj, org, options, cb) {
  //Logger.info({value: entityObj.value, org:org},'Lookup');
  //Logger.debug({options:options}, 'Lookup Options');

  // make a copy of the value so when we modify it we aren't changing the original
  // entityObj.  This will make caching of the entityObj value more consistent.
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
        cb('Integration Received an invalid IPv6 address [' + lookupValue + ']');
        return;
      }
    }

    Logger.debug({ value: lookupValue, org: org }, 'IP Lookup (after IPv6 cleanup to support TC)');

    tc.getAddressTags(lookupValue, org, function(err, orgData) {
      if (err) {
        Logger.error({ err: err }, 'Could not retrieve IP info');
        cb(err);
        return;
      }

      cb(null, orgData, lookupValue);
    });
  } else if (entityObj.isEmail) {
    tc.getEmailTags(lookupValue, org, function(err, orgData) {
      if (err) {
        Logger.error({ err: err }, 'Could not retrieve email info');
        cb(err);
        return;
      }

      cb(null, orgData);
    });
  } else if (entityObj.isHash) {
    tc.getFileTags(lookupValue, org, function(err, orgData) {
      if (err) {
        Logger.error({ err: err }, 'Could not retrieve hash info');
        cb(err);
        return;
      }

      cb(null, orgData);
    });
  } else if (entityObj.isDomain) {
    tc.getHostTags(lookupValue, org, function(err, orgData) {
      if (err) {
        Logger.error({ err: err }, 'Could not retrieve host info');
        cb(err);
        return;
      }

      cb(null, orgData);
    });
  } else {
    cb(null);
  }
}

function onDetails(lookupObject, options, cb) {
  Logger.debug({ lookupObject, options }, 'onDetails Input');

  const details = lookupObject.data.details;
  const tasks = [];

  tc.setSecretKey(options.apiKey);
  tc.setHost(options.url);
  tc.setAccessId(options.accessId);

  for (let i = 0; i < details.length; i++) {
    let org = details[i];
    if (org.meta && org.owner && org.owner.name) {
      tasks.push(function(done) {
        tc.getIndicator(org.meta.indicatorType, org.meta.indicatorValue, org.owner.name, done);
      });
    } else {
      Logger.error(
        { org: org },
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
  }

  async.parallel(tasks, (err, results) => {
    if (err) {
      Logger.error({ err: err }, 'Error in onDetails lookup');
      cb(err);
    } else {
      Logger.debug({ results: results }, 'onDetails Results');
      results.forEach((result) => {
        _modifyWebLinksWithPort(result); //this method mutates result
        if (result.threatAssessScore) {
          result.threatAssessScorePercentage = (result.threatAssessScore / 1000) * 100;
        } else {
          result.threatAssessScorePercentage = 0;
        }
      });
      cb(null, {
        summary: lookupObject.data.summary,
        details: results
      });
    }
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
        function(err, result) {
          if (err) {
            Logger.error({ err, payload }, 'Error Setting Rating');
            cb(err);
          } else {
            Logger.debug({ result: result }, 'Returning SET_RATING');
            cb(null, result);
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
        function(err, result) {
          if (err) {
            Logger.error({ err, payload }, 'Error Setting Rating');
            cb(err);
          } else {
            Logger.debug({ result: result }, 'Returning SET_CONFIDENCE');
            cb(null, result);
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
            cb(err);
          } else {
            Logger.debug({ result: result }, 'Returning REPORT_FALSE_POSITIVE');
            cb(null, result);
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
            cb(err);
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
        (err) => {
          if (err) {
            Logger.error({ err, payload }, 'Error Adding Tag');
            cb(err);
          } else {
            Logger.debug('Returning ADD_TAG');
            cb(null, {});
          }
        }
      );
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
  }
}
function _addPortToLink(weblinkToTransform, port) {
  let weblinkAsUrl = url.parse(weblinkToTransform);
  weblinkAsUrl.port = port;
  delete weblinkAsUrl.host;
  //Logger.info({url: url.format(weblinkAsUrl), port: weblinkAsUrl.port}, 'WebLink');
  return url.format(weblinkAsUrl);
}

function _getSummaryTags(data) {
  let summaryTags = [];

  if (data.owner && data.owner.name) {
    summaryTags.push(data.owner.name);
  }

  if (Array.isArray(data.tags)) {
    for (let i = 0; i < data.tags.length && i <= MAX_SUMMARY_TAGS; i++) {
      let tag = data.tags[i];
      summaryTags.push(tag.name);
    }

    if (data.tags.length > MAX_SUMMARY_TAGS) {
      summaryTags.push('+' + (data.tags.length - MAX_SUMMARY_TAGS));
    }
  }
  return summaryTags;
}

module.exports = {
  doLookup: doLookup,
  startup: startup,
  onMessage: onMessage,
  onDetails: onDetails
};
