let request = require('request');
let querystring = require('querystring');
let crypto = require('crypto');
let url = require('url');

class ThreatConnect {
    constructor(logger) {
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

    // setOrganizations(organizations){
    //     if(typeof organizations === 'string'){
    //         let tokens = organizations.split(',');
    //         tokens.forEach(token => {
    //             token.trim();
    //         });
    //         this.organizations = tokens;
    //     }else{
    //         this.organizations = [];
    //     }
    //
    // }

    setHost(host) {
        if (!this.url || this.url.href !== host) {
            this.url = url.parse(host);
            if (!this.url.href.endsWith('/')) {
                this.url.href += '/';
                this.url.pathname += '/';
                this.url.path += '/';
            }
        }
    }

    getEmail(indicatorValue, owner, cb) {
        if (arguments.length === 2) {
            cb = owner;
            owner = null;
        }

        this._getTagsAndIndicator('emailAddresses', 'emailAddress', indicatorValue, owner, cb);
    }

    getFile(indicatorValue, owner, cb) {
        if (arguments.length === 2) {
            cb = owner;
            owner = null;
        }

        this._getTagsAndIndicator('files', 'file', indicatorValue, owner, cb);
    }

    getHost(indicatorValue, owner, cb) {
        if (arguments.length === 2) {
            cb = owner;
            owner = null;
        }

        this._getTagsAndIndicator('hosts', 'host', indicatorValue, owner, cb);
    }

    getAddress(indicatorValue, owner, cb) {
        if (arguments.length === 2) {
            cb = owner;
            owner = null;
        }

        this._getTagsAndIndicator('addresses', 'address', indicatorValue, owner, cb);
    }

    _getTagsAndIndicator(indicatorTypePlural, indicatorTypeSingular, indicatorValue, owner, cb) {
        let self = this;

        this._getIndicator(indicatorTypePlural, indicatorValue, owner, function (err, response, body) {
            self._formatResponse(err, response, body, function (err, data) {
                if (err || !data) {
                    cb(err, data);
                    return;
                }

                self._getTags(indicatorTypePlural, indicatorValue, owner, function (err, response, body) {
                    self._formatResponse(err, response, body, function (err, tagData) {
                        if (err || !tagData) {
                            cb(err, tagData);
                            return;
                        }

                        let result = data[indicatorTypeSingular];
                        result.tags = tagData.tag;
                        cb(err, result);
                    })
                })
            });
        });
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
            qs = '?' + querystring.stringify({owner: owner});
        } else if (typeof owner === 'function') {
            cb = owner;
        }

        let uri = this._getResourcePath("indicators/" +
            encodeURIComponent(indicatorType) + "/" +
            encodeURIComponent(indicatorValue) + "/tags" + qs);

        let urlPath = this.url.path + "v2/indicators/" +
            encodeURIComponent(indicatorType) + "/" +
            encodeURIComponent(indicatorValue) + "/tags" + qs;

        request({
            uri: uri,
            method: 'GET',
            headers: this._getHeaders(urlPath, 'GET'),
            json: true
        }, cb);
    }

    _getIndicator(indicatorType, indicatorValue, owner, cb) {
        let qs = '';
        if (typeof owner === 'string' && owner.length > 0) {
            qs = '?' + querystring.stringify({owner: owner});
        }

        let uri = this._getResourcePath("indicators/" +
            encodeURIComponent(indicatorType) + "/" +
            encodeURIComponent(indicatorValue) + qs);

        let urlPath = this.url.path + "v2/indicators/" +
            encodeURIComponent(indicatorType) + "/" +
            encodeURIComponent(indicatorValue) + qs;

        request({
            uri: uri,
            method: 'GET',
            headers: this._getHeaders(urlPath, 'GET'),
            json: true
        }, cb);
    }

    _isSuccess(response) {
        if (response.statusCode === 200 &&
            response.body &&
            response.body.status &&
            response.body.status === "Success") {
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
        if (err) {
            cb(err);
            return;
        }

        if (this._isMiss(response)) {
            cb(null);
            return;
        }

        if (this._isSuccess(response)) {
            cb(null, body.data);
        } else {
            cb({
                detail: body.message,
                body: body
            });
        }
    }

    _getHeaders(urlPath, httpMethod) {
        // timestamp should be unix timestamp in seconds
        let timestamp = Math.floor(Date.now() / 1000);
        return {
            'Authorization': this._getAuthHeader(urlPath, httpMethod, timestamp),
            'TimeStamp': timestamp
        };
    }

    _getAuthHeader(urlPath, httpMethod, timestamp) {
        let signature = urlPath + ":" + httpMethod + ":" + timestamp;

        let hmacSignatureInBase64 = crypto
            .createHmac('sha256', this.secretKey)
            .update(signature)
            .digest('base64');

        return "TC " + this.accessId + ":" + hmacSignatureInBase64;
    }

    _getResourcePath(resourcePath) {
        return this.url.href + 'v2/' + resourcePath;
    }
}


module.exports = ThreatConnect;