/*
 * Copyright (c) 2024, Polarity.io, Inc.
 */

/**
 * When looking up indicators in ThreatConnect the "type" of the indicator must be provided.  This method converts
 * the type as specified in Polarity's entity object into the appropriate ThreatConnect type.
 * @param type
 * @returns {string}
 */
function convertPolarityTypeToThreatConnect(type) {
    switch (type) {
        case 'IPv4':
            return 'address';
        case 'IPv6':
            return 'address';
        case 'hash':
            return 'file';
        case 'email':
            return 'emailAddress';
        case 'domain':
            return 'host';
        case 'url':
            return 'url';
    }
}

module.exports = {
    convertPolarityTypeToThreatConnect
}