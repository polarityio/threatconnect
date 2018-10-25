'use strict';

let redis = require('redis');
let _ = require('lodash');
let ipaddr = require('ipaddr.js');
let async = require('async');
let url = require('url');
let ThreatConnect = require('./threatconnect');
let request = require('request');
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

    if (typeof config.request.rejectUnauthorized === 'boolean') {
        defaults.rejectUnauthorized = config.request.rejectUnauthorized;
    }

    tc = new ThreatConnect(request.defaults(defaults), Logger);
}

function doLookup(entities, options, cb) {
    let lookupResults = [];

    tc.setSecretKey(options.apiKey);
    tc.setHost(options.url);
    tc.setAccessId(options.accessId);

    Logger.trace({entities: entities}, 'doLookup');

    let organizations = [];

    if (typeof options.defaultOrganizations === 'string' &&
        options.defaultOrganizations.trim().length > 0) {
        let tokens = options.defaultOrganizations.split(',');
        tokens.forEach(token => {
            token = token.trim();
            if (token.length > 0) {
                organizations.push(token);
            }
        });
    } else {
        organizations.push('');
    }

    Logger.debug({organizations: organizations});

    async.each(entities, function (entityObj, next) {
        _lookupEntity(entityObj, organizations, options, function (err, entityResults) {
            if (err) {
                next(err);
                return;
            }

            lookupResults.push(entityResults);
            next(null);
        });
    }, function (err) {
        cb(err, lookupResults);
    });
}

function _lookupEntity(entityObj, organizations, options, cb) {
    let orgResults = {
        entity: entityObj,
        data: {
            summary: [],
            details: []
        }
    };

    async.each(organizations, function (org, next) {
        _lookupOrg(entityObj, org, options, function (err, data) {
            if (err) {
                next(err);
                return;
            }

            if (data) {
                _getSummaryTags(data).forEach(function (tag) {
                    orgResults.data.summary.push(tag);
                });

                data.webLink = _formatWebLink(data.webLink);

                orgResults.data.details.push(data);
            }

            next(null);
        });
    }, function (err) {
        if (orgResults.data.details.length === 0) {
            cb(err, {entity: entityObj, data: null});
        } else {
            cb(err, orgResults);
        }
    });
}

function _lookupOrg(entityObj, org, options, cb) {
    //Logger.info({value: entityObj.value, org:org},'Lookup');
    //Logger.debug({options:options}, 'Lookup Options');

    // make a copy of the value so when we modify it we aren't changing the original
    // entityObj.  This will make caching of the entityObj value more consistent.
    let lookupValue = entityObj.value;

    if ((entityObj.isIPv4 || entityObj.isIPv6) && options.lookupIps) {
        // TC does not recognize fully expanded IPv6 addresses
        // TC does not recognize leading zeroes in IPv6 address octets
        // TC does not recognize IPv6 addresses unless they are lowercase
        // TC does not recognize IPv6 addresses if they use the "compressed" :: form for zeroes
        if (entityObj.isIPv6) {
            if(ipaddr.isValid(lookupValue)){
                // convert the IPv6 address into a format TC understands
                lookupValue = ipaddr.parse(lookupValue).toNormalizedString();
            }else{
                cb('Integration Received an invalid IPv6 address [' + lookupValue + ']');
                return;
            }
        }

        Logger.debug({value: lookupValue, org: org}, 'IP Lookup (after IPv6 cleanup to support TC)');

        tc.getAddress(lookupValue, org, function (err, orgData) {
            if (err) {
                Logger.error({err: err}, 'Could not retrieve IP info');
                cb(err);
                return;
            }

            cb(null, orgData, lookupValue);
        });
    } else if (entityObj.isEmail && options.lookupEmails) {
        tc.getEmail(lookupValue, org, function (err, orgData) {
            if (err) {
                Logger.error({err: err}, 'Could not retrieve email info');
                cb(err);
                return;
            }

            cb(null, orgData);
        });
    } else if (entityObj.isHash && options.lookupHashes) {
        tc.getFile(lookupValue, org, function (err, orgData) {
            if (err) {
                Logger.error({err: err}, 'Could not retrieve hash info');
                cb(err);
                return;
            }

            cb(null, orgData);
        });
    } else if (entityObj.isDomain && options.lookupHosts) {
        tc.getHost(lookupValue, org, function (err, orgData) {
            if (err) {
                Logger.error({err: err}, 'Could not retrieve host info');
                cb(err);
                return;
            }

            cb(null, orgData);
        });
    } else {
        cb(null);
    }
}

function _formatWebLink(weblink) {
    let weblinkAsUrl = url.parse(weblink);

    if (config.settings.threatConnectPort !== null) {
        weblinkAsUrl.port = config.settings.threatConnectPort;
        // We need to delete the host so that url.format() will recreate
        // it and include the threatConnectPort
        delete weblinkAsUrl.host;
    }

    //Logger.info({url: url.format(weblinkAsUrl), port: weblinkAsUrl.port}, 'WebLink');

    return url.format(weblinkAsUrl);
}

function _getSummaryTags(data) {
    let summaryTags = [];

    if (data.owner && data.owner.name) {
        summaryTags.push('<i class="bts bt-building integration-text-bold-color"></i> ' + data.owner.name);
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
    startup: startup
};
