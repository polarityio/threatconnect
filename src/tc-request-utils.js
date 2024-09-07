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
            return 'addresses';
        case 'IPv6':
            return 'addresses';
        case 'hash':
            return 'files';
        case 'email':
            return 'emailAddresses';
        case 'domain':
            return 'hosts';
        case 'url':
            return 'urls';
    }
}

module.exports = {
    convertPolarityTypeToThreatConnect
}