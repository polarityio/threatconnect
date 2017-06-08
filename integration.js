'use strict';

let redis = require('redis');
let _ = require('lodash');
let async = require('async');
let url = require('url');
let ThreatConnect = require('./threatconnect');
const config = require('./config/config');
const MAX_SUMMARY_TAGS = 6;
let tc;
let Logger;

function startup(logger) {
    Logger = logger;
    tc = new ThreatConnect(Logger);
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
        _lookupEntity(entityObj, organizations, function (err, entityResults) {
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

function _lookupEntity(entityObj, organizations, cb) {
    let orgResults = {
        entity: entityObj,
        data: {
            summary: [],
            details: []
        }
    };

    async.each(organizations, function (org, next) {
        _lookupOrg(entityObj, org, function (err, data) {
            if (err) {
                next(err);
                return;
            }

            if(data){
                _getSummaryTags(data).forEach(function(tag){
                    orgResults.data.summary.push(tag);
                });

                data.webLink = _formatWebLink(data.webLink);

                orgResults.data.details.push(data);
            }

            next(null);
        });
    }, function (err) {
        if(orgResults.data.details.length === 0){
            cb(err, {entity: entityObj, data: null});
        }else{
            cb(err, orgResults);
        }
    });
}

function _lookupOrg(entityObj, org, cb) {
    //Logger.info({value: entityObj.value, org:org},'Lookup');
    if (entityObj.isIPv4 || entityObj.isIPv6) {

        // TC does not recognize fully expanded IPv6 addresses so we
        // remove expanded zeroes to a single
        if(entityObj.isIPv6){
            entityObj.value = entityObj.value.replace(/0000/g, '0');
        }

        // Logger.info({value: entityObj.value, org:org},'Lookup');

        tc.getAddress(entityObj.value, org, function (err, orgData) {
            if (err) {
                Logger.error({err: err}, 'Could not retrieve IP info');
                cb(err);
                return;
            }

            cb(null, orgData);
        });
    } else if (entityObj.isEmail) {
        tc.getEmail(entityObj.value, org, function (err, orgData) {
            if (err) {
                Logger.error({err: err}, 'Could not retrieve email info');
                cb(err);
                return;
            }

            cb(null, orgData);
        });
    } else if (entityObj.isHash) {
        tc.getFile(entityObj.value, org, function (err, orgData) {
            if (err) {
                Logger.error({err: err}, 'Could not retrieve hash info');
                cb(err);
                return;
            }

            cb(null, orgData);
        });
    } else {
        cb(null);
    }
}

function _formatWebLink(weblink){
    let weblinkAsUrl = url.parse(weblink);

    if(config.settings.threatConnectPort !== null){
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
        for(let i=0; i < data.tags.length && i <= MAX_SUMMARY_TAGS; i++){
            let tag = data.tags[i];
            summaryTags.push(tag.name);
        }

        if(data.tags.length > MAX_SUMMARY_TAGS){
            summaryTags.push('+' + (data.tags.length - MAX_SUMMARY_TAGS));
        }
    }
    return summaryTags;
}

module.exports = {
    doLookup: doLookup,
    startup: startup
};