const querystring = require('querystring');
const crypto = require('crypto');
const url = require('url');
const async = require('async');
const fp = require('lodash/fp');
const NodeCache = require('node-cache');
const { logging } = require('./config/config');

const playbookCache = new NodeCache({
  stdTTL: 10 * 60
});

const INDICATOR_TYPES = {
  files: 'file',
  emailAddresses: 'emailAddress',
  hosts: 'host',
  urls: 'url',
  addresses: 'address'
};
const POLARITY_TYPE_TO_THREATCONNECT = {
  IPv4: 'addresses',
  IPv6: 'addresses',
  hash: 'files',
  email: 'emailAddresses',
  domain: 'hosts'
};

const SUBMISSION_LABELS = {
  IPv4: 'ip',
  IPv6: 'ip',
  MD5: 'md5',
  SHA1: 'sha1',
  SHA256: 'sha256',
  email: 'address',
  domain: 'hostName'
};

class ThreatConnect {
  constructor(request, logger) {
    if (logger) {
      this.log = logger;
    } else {
      this.log = {
        info: console.info,
        debug: console.debug,
        trace: console.trace,
        warn: console.warn,
        error: console.error
      };
    }

    this.request = request;
  }

  setSecretKey(secretKey) {
    if (this.secretKey !== secretKey) {
      this.secretKey = secretKey;
    }
  }

  setAccessId(accessId) {
    if (this.accessId !== accessId) {
      this.accessId = accessId;
    }
  }

  setHost(host) {
    if (!this.url || this.url.href !== host) {
      this.url = url.parse(host);
      if (!this.url.href.endsWith('/')) {
        this.url.href += '/';
        this.url.pathname += '/';
        this.url.path += '/';
      }
    }
    this.log.debug({ url: this.url }, 'Parsed URL');
  }

  setEmailRating(indicatorValue, owner, rating, cb) {
    this.setRating(indicatorValue, 'emailAddresses', owner, rating, cb);
  }

  setFileRating(indicatorValue, owner, rating, cb) {
    this.setRating(indicatorValue, 'files', owner, rating, cb);
  }

  setHostRating(indicatorValue, owner, rating, cb) {
    this.setRating(indicatorValue, 'hosts', owner, rating, cb);
  }

  setAddressRating(indicatorValue, owner, rating, cb) {
    this.setRating(indicatorValue, 'addresses', owner, rating, cb);
  }

  updateIndicator(indicatorValue, indicatorType, owner, fieldName, fieldValue, cb) {
    let self = this;

    if (this._isValidIndicatorType(indicatorType) === false) {
      return cb({
        detail: `The provided indicator type '${indicatorType}' is invalid`
      });
    }

    let qs = '';
    if (typeof owner === 'string' && owner.length > 0) {
      qs = '?' + querystring.stringify({ owner: owner });
    }

    let uri = this._getResourcePath(
      'indicators/' + encodeURIComponent(indicatorType) + '/' + encodeURIComponent(indicatorValue) + qs
    );

    let urlPath = `${this.url.path}v2/indicators/${encodeURIComponent(indicatorType)}/${encodeURIComponent(
      indicatorValue
    )}${qs}`;

    const body = {};
    body[fieldName] = fieldValue;

    let requestOptions = {
      uri: uri,
      method: 'PUT',
      headers: this._getHeaders(urlPath, 'PUT'),
      body: body,
      json: true
    };

    self.log.debug({ requestOptions }, 'setRating request options');

    this.request(requestOptions, function (err, response, body) {
      self._formatResponse(err, response, body, function (err, data) {
        if (err) {
          cb(err);
        } else {
          cb(null, self._enrichResult(indicatorType, indicatorValue, data[INDICATOR_TYPES[indicatorType]]));
        }
      });
    });
  }

  setRating(indicatorValue, indicatorType, owner, rating, cb) {
    this.updateIndicator(indicatorValue, indicatorType, owner, 'rating', rating, cb);
  }

  setConfidence(indicatorValue, indicatorType, owner, rating, cb) {
    this.updateIndicator(indicatorValue, indicatorType, owner, 'confidence', rating, cb);
  }

  getEmailTags(indicatorValue, owner, cb) {
    if (arguments.length === 2) {
      cb = owner;
      owner = null;
    }

    this.getTags('emailAddresses', indicatorValue, owner, cb);
  }

  getFileTags(indicatorValue, owner, cb) {
    if (arguments.length === 2) {
      cb = owner;
      owner = null;
    }

    this.getTags('files', indicatorValue, owner, cb);
  }

  getHostTags(indicatorValue, owner, cb) {
    if (arguments.length === 2) {
      cb = owner;
      owner = null;
    }

    this.getTags('hosts', indicatorValue, owner, cb);
  }

  getAddressTags(indicatorValue, owner, cb) {
    if (arguments.length === 2) {
      cb = owner;
      owner = null;
    }

    this.getTags('addresses', indicatorValue, owner, cb);
  }

  getEmail(indicatorValue, owner, cb) {
    if (arguments.length === 2) {
      cb = owner;
      owner = null;
    }

    this.getIndicator('emailAddresses', indicatorValue, owner, cb);
  }

  /**
   * Returns all owners for the given email address
   * @param {String} indicatorValue, an email address
   * @param owner
   * @param cb
   */
  getEmailOwners(indicatorValue, owner, cb) {
    this.getOwners('emailAddresses', indicatorValue, cb);
  }

  getFile(indicatorValue, owner, cb) {
    if (arguments.length === 2) {
      cb = owner;
      owner = null;
    }

    this.getIndicator('files', indicatorValue, owner, cb);
  }

  /**
   * Returns all owners for the given file (hash)
   * @param {String} indicatorValue, a file hash
   * @param cb
   */
  getFileOwners(indicatorValue, cb) {
    this.getOwners('files', indicatorValue, cb);
  }

  getHost(indicatorValue, owner, cb) {
    if (arguments.length === 2) {
      cb = owner;
      owner = null;
    }

    this.getIndicator('hosts', indicatorValue, owner, cb);
  }

  /**
   * Returns all owners for the given host (domain)
   * @param {String} indicatorValue, a domain
   * @param cb
   */
  getHostOwners(indicatorValue, cb) {
    this.getOwners('hosts', indicatorValue, cb);
  }

  getAddress(indicatorValue, owner, cb) {
    if (arguments.length === 2) {
      cb = owner;
      owner = null;
    }

    this.getIndicator('addresses', indicatorValue, owner, cb);
  }

  /**
   * Returns all owners for the given address (IPv4 or IPv6)
   * @param {String} indicatorValue, IPv4 or IPv6 address
   * @param cb
   */
  getAddressOwners(indicatorValue, cb) {
    this.getOwners('addresses', indicatorValue, cb);
  }

  _isValidIndicatorType(indicatorType) {
    if (typeof INDICATOR_TYPES[indicatorType] !== 'undefined') {
      return true;
    } else {
      return false;
    }
  }

  /**
   * This method is used to encode the URI path which is required by TC for authentication.  The URI Path
   * must match how the request library encodes the URL or authentication will fail.  The built-in encodeURIComponent
   * does not encode the following characters `!'()*` which prevents authentication from working.
   *
   * See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
   * @param str
   * @returns {string}
   * @private
   */
  _fixedEncodeURIComponent(str) {
    return encodeURIComponent(str).replace(/[!'()*]/g, function (c) {
      return '%' + c.charCodeAt(0).toString(16);
    });
  }

  reportFalsePositive(indicatorTypePlural, indicatorValue, owner, cb) {
    const self = this;

    let qs = '';
    if (typeof owner === 'string' && owner.length > 0) {
      qs = '?' + querystring.stringify({ owner: owner });
    } else if (typeof owner === 'function') {
      cb = owner;
    }

    const urlPath = `${this.url.path}v2/indicators/${indicatorTypePlural}/${this._fixedEncodeURIComponent(
      indicatorValue
    )}/falsePositive${qs}`;

    const uri = `${this.url.href}v2/indicators/${indicatorTypePlural}/${this._fixedEncodeURIComponent(
      indicatorValue
    )}/falsePositive${qs}`;

    let requestOptions = {
      uri: uri,
      method: 'POST',
      headers: this._getHeaders(urlPath, 'POST'),
      json: true
    };

    this.request(requestOptions, (err, response, body) => {
      if (err) {
        return cb(err);
      }

      if (self._isSuccess(response)) {
        cb(null, body.data.falsePositive);
      } else {
        cb({
          statusCode: response.statusCode,
          response: response,
          detail: 'There was an unexpected error marking the indicator as a false positive'
        });
      }
    });
  }

  deleteTag(indicatorTypePlural, indicatorValue, tag, owner, cb) {
    const self = this;

    let qs = '';
    if (typeof owner === 'string' && owner.length > 0) {
      qs = '?' + querystring.stringify({ owner: owner });
    } else if (typeof owner === 'function') {
      cb = owner;
    }

    const urlPath = `${this.url.path}v2/indicators/${indicatorTypePlural}/${this._fixedEncodeURIComponent(
      indicatorValue
    )}/tags/${this._fixedEncodeURIComponent(tag)}${qs}`;

    const uri = `${this.url.href}v2/indicators/${indicatorTypePlural}/${this._fixedEncodeURIComponent(
      indicatorValue
    )}/tags/${this._fixedEncodeURIComponent(tag)}${qs}`;

    let requestOptions = {
      uri: uri,
      method: 'DELETE',
      headers: this._getHeaders(urlPath, 'DELETE'),
      json: true
    };

    this.request(requestOptions, (err, response, body) => {
      self._formatResponse(err, response, body, (err) => {
        if (err) {
          cb(err);
        } else {
          cb(null);
        }
      });
    });
  }

  addTag(indicatorTypePlural, indicatorValue, tag, owner, cb) {
    const self = this;

    let qs = '';
    if (typeof owner === 'string' && owner.length > 0) {
      qs = '?' + querystring.stringify({ owner: owner });
    } else if (typeof owner === 'function') {
      cb = owner;
    }

    const urlPath = `${this.url.path}v2/indicators/${indicatorTypePlural}/${this._fixedEncodeURIComponent(
      indicatorValue
    )}/tags/${this._fixedEncodeURIComponent(tag)}${qs}`;

    const uri = `${this.url.href}v2/indicators/${indicatorTypePlural}/${this._fixedEncodeURIComponent(
      indicatorValue
    )}/tags/${this._fixedEncodeURIComponent(tag)}${qs}`;

    let requestOptions = {
      uri: uri,
      method: 'POST',
      headers: this._getHeaders(urlPath, 'POST'),
      json: true
    };

    this.request(requestOptions, (err, response, body) => {
      self._formatResponse(err, response, body, (err) => {
        if (err) {
          cb(err);
        } else {
          cb(null, {
            link: `${self.url.protocol}//${self.url.host}/auth/tags/tag.xhtml?owner=${owner}&tag=${tag}`
          });
        }
      });
    });
  }

  getOwners(indicatorTypePlural, indicatorValue, cb) {
    let self = this;
    this._getOwners(indicatorTypePlural, indicatorValue, (err, response, body) => {
      this._formatResponse(err, response, body, (formatErr, ownerData) => {
        if (formatErr) {
          return cb(formatErr);
        }

        if (!ownerData) {
          return cb(null, {
            meta: {
              indicatorType: indicatorTypePlural,
              indicatorValue: indicatorValue
            },
            owners: []
          });
        }

        cb(null, {
          meta: {
            indicatorType: indicatorTypePlural,
            indicatorValue: indicatorValue
          },
          owners: ownerData.owner
        });
      });
    });
  }

  getTags(indicatorTypePlural, indicatorValue, owner, cb) {
    let self = this;
    self._getTags(indicatorTypePlural, indicatorValue, owner, function (err, response, body) {
      self._formatResponse(err, response, body, function (err, tagData) {
        if (err || !tagData) {
          return cb(err);
        }

        cb(null, {
          meta: {
            indicatorType: indicatorTypePlural,
            indicatorValue: indicatorValue
          },
          owner: {
            name: owner
          },
          tags: tagData.tag
        });
      });
    });
  }

  getGroupAssociations(indicatorTypePlural, indicatorValue, owner, cb) {
    let self = this;
    self._getGroupAssociations(indicatorTypePlural, indicatorValue, owner, function (err, response, body) {
      self._formatResponse(err, response, body, function (err, groupData) {
        if (err) {
          return cb(err);
        }

        if (!groupData) {
          return cb(null, {
            meta: {
              indicatorType: indicatorTypePlural,
              indicatorValue: indicatorValue
            },
            groups: []
          });
        }

        cb(null, {
          meta: {
            indicatorType: indicatorTypePlural,
            indicatorValue: indicatorValue
          },
          owner: {
            name: owner
          },
          groups: groupData.group
        });
      });
    });
  }

  getIndicatorAssociations(indicatorTypePlural, indicatorValue, owner, cb) {
    let self = this;
    self._getIndicatorAssociations(indicatorTypePlural, indicatorValue, owner, function (err, response, body) {
      self._formatResponse(err, response, body, function (err, indicatorData) {
        if (err) {
          return cb(err);
        }

        if (!indicatorData) {
          return cb(null, {
            meta: {
              indicatorType: indicatorTypePlural,
              indicatorValue: indicatorValue
            },
            indicators: []
          });
        }

        cb(null, {
          meta: {
            indicatorType: indicatorTypePlural,
            indicatorValue: indicatorValue
          },
          owner: {
            name: owner
          },
          indicators: indicatorData.indicator
        });
      });
    });
  }

  getIndicator(indicatorTypePlural, indicatorValue, owner, cb) {
    let self = this;
    const indicatorTypeSingular = INDICATOR_TYPES[indicatorTypePlural];
    if (typeof indicatorTypeSingular === 'undefined') {
      return cb({
        detail: `The provided indicator type '${indicatorTypePlural}' is invalid`
      });
    }

    this._getIndicator(indicatorTypePlural, indicatorValue, owner, function (err, response, body) {
      self._formatResponse(err, response, body, function (err, data) {
        if (err || !data) return cb(err, data);

        let result = data[indicatorTypeSingular];
        result = self._enrichResult(indicatorTypePlural, indicatorValue, result);
        self.getPlaybooksForIndicator(result, (err, playbooks) => {
          if (err) return cb(err);

          cb(null, { ...result, playbooks });
        });
      });
    });
  }

  getDnsInformation(indicatorTypePlural, indicatorValue, owner, cb) {
    let self = this;
    let indicatorTypeSingular;

    if (indicatorTypePlural === 'addresses' || indicatorTypePlural === 'hosts') {
      indicatorTypeSingular = 'dnsResolution';
    }

    if (typeof indicatorTypeSingular === 'undefined') {
      return cb({
        detail: `The provided indicator type '${indicatorTypePlural}' is invalid`
      });
    }

    this._getDnsInformation(indicatorTypePlural, indicatorValue, owner, function (err, response, body) {
      self._formatResponse(err, response, body, function (err, data) {
        if (err || !data) return cb(err, data);
        
        const hasDnsResolutionData =
          (data.dnsResolution && data.dnsResolution.length > 0) || (data.indicator && data.indicator.length > 0);

        if (hasDnsResolutionData) {
          let responseData = data.dnsResolution && data.dnsResolution.length > 0 ? data.dnsResolution : data.indicator;
          let result = self._enrichResult(indicatorTypePlural, indicatorValue, responseData);
          cb(null, { result });
        } else {
          cb(null, []);
        }
      });
    });
  }

  _enrichResult(indicatorType, indicatorValue, result) {
    if (result) {
      result.meta = {
        indicatorType: indicatorType,
        indicatorValue: indicatorValue
      };

      if (typeof result.rating === 'undefined') {
        result.rating = 0;
      }

      result.ratingHuman = this._getRatingHuman(result.rating);

      if (typeof result.confidence === 'undefined') {
        result.confidence = 0;
      }
      result.confidenceHuman = this._getConfidenceHuman(result.confidence);

      if (!Array.isArray(result.tag)) {
        result.tag = [];
      }

      return result;
    }
  }

  _getConfidenceHuman(confidence) {
    if (!confidence || confidence === 0) {
      return 'Unassessed';
    }

    if (confidence <= 25) {
      return 'Improbable';
    }

    if (confidence <= 49) {
      return 'Doubtful';
    }

    if (confidence <= 69) {
      return 'Possible';
    }

    if (confidence <= 89) {
      return 'Probable';
    }

    return 'Confirmed';
  }

  _getRatingHuman(rating) {
    switch (rating) {
      case 0:
        return 'Unknown';
      case 1:
        return 'Suspicious';
      case 2:
        return 'Low';
      case 3:
        return 'Moderate';
      case 4:
        return 'High';
      case 5:
        return 'Critical';
      default:
        return 'Unknown';
    }
  }

  _getGroupAssociations(indicatorType, indicatorValue, owner, cb) {
    let qs = '';
    if (typeof owner === 'string' && owner.length > 0) {
      qs = '?' + querystring.stringify({ owner: owner });
    } else if (typeof owner === 'function') {
      cb = owner;
    }

    let uri = this._getResourcePath(
      'indicators/' + encodeURIComponent(indicatorType) + '/' + encodeURIComponent(indicatorValue) + '/groups' + qs
    );

    let urlPath =
      this.url.path +
      'v2/indicators/' +
      encodeURIComponent(indicatorType) +
      '/' +
      encodeURIComponent(indicatorValue) +
      '/groups' +
      qs;

    let requestOptions = {
      uri: uri,
      method: 'GET',
      headers: this._getHeaders(urlPath, 'GET'),
      json: true
    };

    this.request(requestOptions, cb);
  }

  _getIndicatorAssociations(indicatorType, indicatorValue, owner, cb) {
    let qs = '';
    if (typeof owner === 'string' && owner.length > 0) {
      qs = '?' + querystring.stringify({ owner: owner });
    } else if (typeof owner === 'function') {
      cb = owner;
    }

    let uri = this._getResourcePath(
      'indicators/' + encodeURIComponent(indicatorType) + '/' + encodeURIComponent(indicatorValue) + '/indicators' + qs
    );

    let urlPath =
      this.url.path +
      'v2/indicators/' +
      encodeURIComponent(indicatorType) +
      '/' +
      encodeURIComponent(indicatorValue) +
      '/indicators' +
      qs;

    let requestOptions = {
      uri: uri,
      method: 'GET',
      headers: this._getHeaders(urlPath, 'GET'),
      json: true
    };

    this.request(requestOptions, cb);
  }

  _getOwners(indicatorType, indicatorValue, cb) {
    let uri = this._getResourcePath(
      `indicators/${encodeURIComponent(indicatorType)}/${encodeURIComponent(indicatorValue)}/owners`
    );

    let urlPath = `${this.url.path}v2/indicators/${encodeURIComponent(indicatorType)}/${encodeURIComponent(
      indicatorValue
    )}/owners`;

    let requestOptions = {
      uri: uri,
      method: 'GET',
      headers: this._getHeaders(urlPath, 'GET'),
      json: true
    };

    this.request(requestOptions, cb);
  }

  /**
   *
   * @param indicatorType
   * @param indicatorValue
   * @param owner
   * @param cb
   */
  _getTags(indicatorType, indicatorValue, owner, cb) {
    let qs = '';
    if (typeof owner === 'string' && owner.length > 0) {
      qs = '?' + querystring.stringify({ owner: owner });
    } else if (typeof owner === 'function') {
      cb = owner;
    }

    let uri = this._getResourcePath(
      'indicators/' + encodeURIComponent(indicatorType) + '/' + encodeURIComponent(indicatorValue) + '/tags' + qs
    );

    let urlPath =
      this.url.path +
      'v2/indicators/' +
      encodeURIComponent(indicatorType) +
      '/' +
      encodeURIComponent(indicatorValue) +
      '/tags' +
      qs;

    let requestOptions = {
      uri: uri,
      method: 'GET',
      headers: this._getHeaders(urlPath, 'GET'),
      json: true
    };

    this.request(requestOptions, cb);
  }

  _getIndicator(indicatorType, indicatorValue, owner, cb) {
    let qs = '';
    if (typeof owner === 'string' && owner.length > 0) {
      qs = '?' + querystring.stringify({ owner: owner, includeAdditional: true, includeTags: true });
    } else {
      qs = '?includeAdditional=true&includeTags=true';
    }

    let uri = this._getResourcePath(
      'indicators/' + encodeURIComponent(indicatorType) + '/' + encodeURIComponent(indicatorValue) + qs
    );

    let urlPath =
      this.url.path +
      'v2/indicators/' +
      encodeURIComponent(indicatorType) +
      '/' +
      encodeURIComponent(indicatorValue) +
      qs;

    let requestOptions = {
      uri: uri,
      method: 'GET',
      headers: this._getHeaders(urlPath, 'GET'),
      json: true
    };

    this.request(requestOptions, cb);
  }

  _getDnsInformation(indicatorType, indicatorValue, owner, cb) {
    let qs =
      typeof owner === 'string' && owner.length > 0
        ? `?${querystring.stringify({ owner })}`
        : '?includeAdditional=true&includeTags=true';

    let uri = this._getResourcePath(
      'indicators/' +
        encodeURIComponent(indicatorType) +
        '/' +
        encodeURIComponent(indicatorValue) +
        '/' +
        'dnsResolutions' +
        qs
    );

    let urlPath =
      this.url.path +
      'v2/indicators/' +
      encodeURIComponent(indicatorType) +
      '/' +
      encodeURIComponent(indicatorValue) +
      '/' +
      'dnsResolutions' +
      qs;

    let requestOptions = {
      uri: uri,
      method: 'GET',
      headers: this._getHeaders(urlPath, 'GET'),
      json: true
    };

    this.log.trace({ REQUEST_OPTS: requestOptions });

    this.request(requestOptions, cb);
  }

  _isSuccess(response) {
    if (
      (response.statusCode === 200 || response.statusCode === 201) &&
      response.body &&
      response.body.status &&
      response.body.status === 'Success'
    ) {
      return true;
    }
    return false;
  }

  _isMiss(response) {
    if (response.statusCode === 404) {
      return true;
    }

    return false;
  }

  _formatResponse(err, response, body, cb) {
    const self = this;

    self.log.trace({ err, status: response ? response.statusCode : 'NA', body }, '_formatResponse');

    if (err) {
      cb(err);
      return;
    }

    if (body && typeof body.status === 'undefined') {
      // this is an unexpected response that does not match the normal payload response
      return cb({
        detail: 'Received an unexpected response.  Please check your URL.',
        body: body,
        statusCode: response && response.statusCode ? response.statusCode : 500
      });
    }

    if (this._isMiss(response)) {
      self.log.trace({ RESPONSE: response });
      cb(null);
      return;
    }

    if (this._isSuccess(response)) {
      self.log.debug({ data: body.data }, 'TC Result');
      cb(null, body.data);
    } else {
      cb({
        detail: body && body.message ? body.message : '[No detail property found (body.message)]',
        body: body ? body : '[body is undefined]',
        response: response
      });
    }
  }

  _getHeaders(urlPath, httpMethod) {
    // timestamp should be unix timestamp in seconds
    let timestamp = Math.floor(Date.now() / 1000);
    return {
      Authorization: this._getAuthHeader(urlPath, httpMethod, timestamp),
      TimeStamp: timestamp
    };
  }

  _getAuthHeader(urlPath, httpMethod, timestamp) {
    let signature = urlPath + ':' + httpMethod + ':' + timestamp;

    this.log.trace({ signature: signature }, 'Auth Signature');

    let hmacSignatureInBase64 = crypto.createHmac('sha256', this.secretKey).update(signature).digest('base64');

    return 'TC ' + this.accessId + ':' + hmacSignatureInBase64;
  }

  _getResourcePath(resourcePath) {
    return this.url.href + 'v2/' + resourcePath;
  }
  _getResourcePathInternal(resourcePath) {
    return this.url.href + 'internal/' + resourcePath;
  }
  getPlaybooksForIndicator(indicator, callback) {
    const indicatorType = fp.toLower(INDICATOR_TYPES[fp.get('meta.indicatorType', indicator)]);
    if (!indicatorType) return cb({ err: indicator, detail: 'Getting Playbooks Failed - No Indicator Type Found' });

    this.getPlaybooks((err, playbooks) => {
      if (err) return callback(err);

      const playbooksForThisIndicator = fp.filter(
        fp.flow(fp.getOr([], 'playbookTriggerTypes'), fp.includes(indicatorType)),
        playbooks
      );
      return callback(null, playbooksForThisIndicator);
    });
  }
  getPlaybooks(callback) {
    const cachedPlaybooks = playbookCache.get('playbooks');
    if (cachedPlaybooks) return callback(null, cachedPlaybooks);

    const self = this;
    const qs = querystring.stringify({
      page: 0,
      limit: 1000,
      type: 'Playbook',
      triggerType: 'UserAction',
      sortOn: 'name',
      sortAscending: true
    });
    const path = `playbooks/search?${qs}`;
    const uri = this._getResourcePath(path);

    let requestOptions = {
      uri,
      method: 'GET',
      headers: this._getHeaders(`/api/v2/${path}`, 'GET'),
      json: true
    };

    this.request(requestOptions, (err, response, body) => {
      if (err) return callback(err);

      const foundPlaybooks = fp.getOr([], 'data.playbook')(body);

      async.parallel(
        fp.map(
          (playbook) => (done) =>
            self.getPlaybookTriggerTypes(playbook.id, (err, playbookTriggerTypes) => {
              if (err) return done(err);
              done(null, { ...playbook, playbookTriggerTypes });
            }),
          foundPlaybooks
        ),
        (err, playbooksWithTriggerTypes) => {
          if (err) return callback(err);
          playbookCache.set('playbooks', playbooksWithTriggerTypes);

          callback(null, playbooksWithTriggerTypes);
        }
      );
    });
  }

  getPlaybookTriggerTypes(playbookId, callback) {
    if (!playbookId)
      return callback({
        err: `PlaybookId: ${playbookId}`,
        detail: 'Getting Getting Playbook Trigger Failed - No Playbook Id'
      });

    const path = `playbooks/${playbookId}`;
    const uri = this._getResourcePath(path);

    let requestOptions = {
      uri,
      method: 'GET',
      headers: this._getHeaders(`/api/v2/${path}`, 'GET'),
      json: true
    };

    this.request(requestOptions, (err, response, body) => {
      if (err) return callback(err || { err: body, detail: 'Getting Playbook Trigger Failed' });

      const playbookTriggerTypes = fp.flow(
        fp.getOr([], 'playbookTriggerList'),
        fp.filter((playbookTrigger) => playbookTrigger.type === 'UserAction'),
        fp.map(fp.get('userActionTypes')),
        fp.join(','),
        fp.split(','),
        fp.map(fp.toLower),
        fp.compact,
        fp.uniq
      )(body);

      callback(null, playbookTriggerTypes);
    });
  }
}

module.exports = ThreatConnect;
