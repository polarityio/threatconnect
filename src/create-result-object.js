const { getLogger } = require('./logger');
const url = require('url');

const MAX_SUMMARY_TAGS = 4;
/**
 *
 * @param entities
 * @param apiResponse
 * @returns {*[]}
 */
const createResultObjects = (entity, apiResponse, options) => {
  const lookupResults = [];

  if (apiResponse.data && apiResponse.data.length > 0) {
    const indicatorsById = apiResponse.data.reduce((accum, indicator) => {
      accum[indicator.id] = {
        indicator
      };
      return accum;
    }, {});

    const urlParts = url.parse(options.url);

    lookupResults.push({
      entity,
      data: {
        summary: createSummary(apiResponse.data, options),
        details: {
          indicators: indicatorsById,
          appUrl: `${urlParts.protocol}//${urlParts.host}`
        }
      }
    });
  } else {
    lookupResults.push({
      entity,
      data: null
    });
  }

  return lookupResults;
};

/**
 * Creates the Summary Tags (currently just tags for ports)
 * @param match
 * @returns {string[]}
 */
const createSummary = (indicators, options) => {
  const Logger = getLogger();
  let tags = [];

  for (let i = 0; i < indicators.length && i < MAX_SUMMARY_TAGS; i++) {
    tags.push(`${_getOwnerIcon()} ${indicators[i].ownerName}`);
  }
  if (indicators.length > tags.length) {
    tags.push(`+${indicators.length - tags.length}`);
  }

  return tags;
};

function _getOwnerIcon() {
  return `<svg viewBox="0 0 448 512" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true" data-icon="building" data-prefix="fas" id="ember1223" class="svg-inline--fa fa-building fa-w-14  ember-view"><path fill="currentColor" d="M436 480h-20V24c0-13.255-10.745-24-24-24H56C42.745 0 32 10.745 32 24v456H12c-6.627 0-12 5.373-12 12v20h448v-20c0-6.627-5.373-12-12-12zM128 76c0-6.627 5.373-12 12-12h40c6.627 0 12 5.373 12 12v40c0 6.627-5.373 12-12 12h-40c-6.627 0-12-5.373-12-12V76zm0 96c0-6.627 5.373-12 12-12h40c6.627 0 12 5.373 12 12v40c0 6.627-5.373 12-12 12h-40c-6.627 0-12-5.373-12-12v-40zm52 148h-40c-6.627 0-12-5.373-12-12v-40c0-6.627 5.373-12 12-12h40c6.627 0 12 5.373 12 12v40c0 6.627-5.373 12-12 12zm76 160h-64v-84c0-6.627 5.373-12 12-12h40c6.627 0 12 5.373 12 12v84zm64-172c0 6.627-5.373 12-12 12h-40c-6.627 0-12-5.373-12-12v-40c0-6.627 5.373-12 12-12h40c6.627 0 12 5.373 12 12v40zm0-96c0 6.627-5.373 12-12 12h-40c-6.627 0-12-5.373-12-12v-40c0-6.627 5.373-12 12-12h40c6.627 0 12 5.373 12 12v40zm0-96c0 6.627-5.373 12-12 12h-40c-6.627 0-12-5.373-12-12V76c0-6.627 5.373-12 12-12h40c6.627 0 12 5.373 12 12v40z"></path></svg> `;
}

module.exports = {
  createResultObjects
};
