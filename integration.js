'use strict';

let redis = require('redis');
let _ = require('lodash');
let async = require('async');
let ThreatConnect = require('./threatconnect');
let tc;
let Logger;

function startup(logger) {
    Logger = logger;
    tc = new ThreatConnect();
}

function doLookup(entities, options, cb) {
    let lookupResults = [];

    Logger.info(options);

    tc.setSecretKey(options.apiKey);
    tc.setHost(options.url);
    tc.setAccessId(options.accessId);

    Logger.trace({entities: entities}, 'doLookup');

    async.each(entities, function (entityObj, next) {
        if (entityObj.isIPv4 || entityObj.isIPv6) {
            tc.getAddress(entityObj.value, function (err, data) {
                if (err) {
                    Logger.error({err: err}, 'Could not retrieve IP info');
                    next(err);
                }

                lookupResults.push(_processLookupResult(entityObj, data));
                next(null);
            });
        } else if (entityObj.isEmail) {
            tc.getEmail(entityObj.value, function (err, data) {
                if (err) {
                    Logger.error({err: err}, 'Could not retrieve email info');
                    next(err);
                }

                lookupResults.push(_processLookupResult(entityObj, data));
                next(null);
            });

        } else if (entityObj.isHash) {
            tc.getFile(entityObj.value, function (err, data) {
                if (err) {
                    Logger.error({err: err}, 'Could not retrieve hash info');
                    next(err);
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