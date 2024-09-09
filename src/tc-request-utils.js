const ipaddr = require('ipaddr.js');
const { getLogger } = require('./logger');
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

/**
 * ThreatConnect has limited support for IPv6 formats.  This method converts the value of the provided entityObj
 * into a valid value for ThreatConnect.  If a conversion cannot be done, the method returns null.
 * @param entityObj
 * @returns {*}
 * @private
 */
function filterInvalidEntities(entities) {
  return entities.reduce((accum, entity) => {
    // TC does not recognize fully expanded IPv6 addresses
    // TC does not recognize leading zeroes in IPv6 address octets
    // TC does not recognize IPv6 addresses unless they are lowercase
    // TC does not recognize IPv6 addresses if they use the "compressed" :: form for zeroes
    if (entity.isIPv6) {
      if (ipaddr.isValid(entity.value)) {
        // convert the IPv6 address into a format TC understands
        entity.value = ipaddr.parse(entity.value).toNormalizedString();
        accum.push(entity);
      } else {
        // Integration Received an invalid IPv6 address
        getLogger().warn(`Unsupported IPv6 address format ignored: [${entityObj.value}]`);
      }
    } else {
      accum.push(entity);
    }

    return accum;
  }, []);
}

module.exports = {
  convertPolarityTypeToThreatConnect,
  filterInvalidEntities
};
