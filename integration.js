'use strict';

let redis = require('redis');
let _ = require('lodash');
let async = require('async');
let ThreatConnect = require('./threatconnect');
let tc;
let Logger;

function startup(logger) {
    Logger = logger;
    tc = new ThreatConnect(Logger);
}

function doLookup(entities, options, cb) {
    tc.setSecretKey(options.apiKey);
    tc.setHost(options.url);
    tc.setAccessId(options.accessId);

    //Logger.trace({entities: entities}, 'doLookup');

    let organizations = [];

    if (typeof options.defaultOrganizations === 'string' &&
        options.defaultOrganizations.trim().length > 0) {
        let tokens = options.defaultOrganizations.split(',');
        tokens.forEach(token => {
            token = token.trim();
            if(token.length > 0){
                organizations.push(token);
            }
        });
    } else {
        organizations.push('');
    }

    Logger.debug({organizations: organizations});

    organizations.forEach(function(org){
        _lookupOrg(entities, org, cb);
    });
}

function _lookupOrg(entities, org, cb){
    let lookupResults = [];

    async.each(entities, function (entityObj, next) {
        //Logger.info({value: entityObj.value, org:org},'Lookup');
        if (entityObj.isIPv4 || entityObj.isIPv6) {
            tc.getAddress(entityObj.value, org, function (err, data) {
                if (err) {
                    Logger.error({err: err}, 'Could not retrieve IP info');
                    next(err);
                    return;
                }

                lookupResults.push(_processLookupResult(entityObj, data));
                next(null);
            });
        } else if (entityObj.isEmail) {
            tc.getEmail(entityObj.value, org, function (err, data) {
                if (err) {
                    Logger.error({err: err}, 'Could not retrieve email info');
                    next(err);
                    return;
                }

                lookupResults.push(_processLookupResult(entityObj, data));
                next(null);
            });
        } else if (entityObj.isHash) {
            tc.getFile(entityObj.value, org, function (err, data) {
                if (err) {
                    Logger.error({err: err}, 'Could not retrieve hash info');
                    next(err);
                    return;
                }

                lookupResults.push(_processLookupResult(entityObj, data));
                next(null);
            });
        }
        else {
            next(null);
        }
    }, function (err) {
        Logger.trace({lookupResults: lookupResults}, 'Lookup Results');
        cb(err, lookupResults);
    });
}

function _processLookupResult(entityObj, data) {
    if (data) {
        return {
            // Required: This is the entity object passed into the integration doLookup method
            entity: entityObj,
            // Required: An object containing everything you want passed to the template
            data: {
                // Required: These are the tags that are displayed in your template
                summary: _getSummaryTags(data),
                // Data that you want to pass back to the notification window details block
                details: data
            }
        };
    } else {
        return {entity: entityObj, data: null};
    }
}

function _getSummaryTags(data) {
    let summaryTags = [];

    if (data.owner && data.owner.name) {
        summaryTags.push('<i class="bts bt-building integration-text-bold-color"></i> ' + data.owner.name);
    }

    if (Array.isArray(data.tags)) {
        data.tags.forEach(tag => {
            summaryTags.push(tag.name);
        })
    }
    return summaryTags;
}

module.exports = {
    doLookup: doLookup,
    startup: startup
};