/*
 * Copyright (c) 2025, Polarity.io, Inc.
 */

const async = require('async');
const polarityRequest = require('../polarity-request');
const { ApiRequestError } = require('../errors');
const { getLogger } = require('../logger');
const SUCCESS_CODES = [200, 201];
const MAX_CHARACTER_COUNT_PER_INTEGRATION = 65000;

/**
 *
 * @param caseId
 * @param options
 * @returns {Promise<*>}
 */
async function addIntegrationDataAsNote(payload, options) {
  const Logger = getLogger();
  const integrationData = payload.integrationData || [];
  const annotations = payload.annotations || [];

  const allNoteChunks = [];

  for (const integration of integrationData) {
    const { characterCount, lines: rawLines, integrationName } = getIntegrationDataExpansion(integration);

    const headerLines = [`### Integration: ${integration.integrationName}`];
    if (Array.isArray(integration.data.summary)) {
      for (const tag of integration.data.summary) {
        headerLines.push(`- ${getTagText(tag)}`);
      }
    }
    headerLines.push('');

    const TABLE_HEADER = ['Field | Value', '----- | -----'];
    const linesWithHeaders = [...rawLines, '\n---\n'];

    const chunks = splitLinesByCharacterLimit(linesWithHeaders, MAX_CHARACTER_COUNT_PER_INTEGRATION);

    chunks.forEach((chunk, i) =>
      Logger.debug({ index: i, charCount: chunk.length, preview: chunk.slice(0, 3) }, 'Chunk preview')
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = [...chunks[i]];
      const finalChunk = [];

      finalChunk.push(...headerLines);

      finalChunk.push(...TABLE_HEADER);

      const contentOnly = chunk.filter(
        (line) =>
          !line.startsWith('### Integration:') &&
          !line.startsWith('- ') &&
          !TABLE_HEADER.includes(line.trim()) &&
          line.trim() !== ''
      );

      finalChunk.push(...contentOnly);
      allNoteChunks.push(finalChunk);
    }
  }

  if (annotations && annotations.data?.length) {
    const annotationText = formatAnnotationsAsFixedWidthText(payload.annotations);
    allNoteChunks.push(['### Polarity Annotations', '', ...annotationText.split('\n')]);
  }

  const newlyCreatedNotes = [];

  await async.eachOfLimit(allNoteChunks, 1, async (chunk, index) => {
    const noteText = [
      `(${index + 1} of ${allNoteChunks.length}) Polarity Integration Data – added via Polarity`,
      '',
      ...chunk
    ].join('\n');

    const noteBody = {
      text: truncateIfNeeded(noteText, MAX_CHARACTER_COUNT_PER_INTEGRATION)
    };

    Logger.debug({ noteBody }, 'Payload being sent to ThreatConnect');

    const addedNote = await addNote(payload.caseId, options, noteBody);
    newlyCreatedNotes.push(addedNote);
  });

  return newlyCreatedNotes;
}

function splitLinesByCharacterLimit(lines, maxChars) {
  const chunks = [];
  let currentChunk = [];
  let currentLength = 0;

  for (const line of lines) {
    const lineLength = line.length + 1;

    if (lineLength > maxChars) {
      const slicedLines = line.match(new RegExp(`.{1,${maxChars - 1}}`, 'g')) || [];
      for (const sliced of slicedLines) {
        if (currentLength + sliced.length + 1 > maxChars) {
          chunks.push(currentChunk);
          currentChunk = [];
          currentLength = 0;
        }
        currentChunk.push(sliced);
        currentLength += sliced.length + 1;
      }
      continue;
    }

    if (currentLength + lineLength > maxChars) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLength = 0;
    }

    currentChunk.push(line);
    currentLength += lineLength;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function formatAnnotationsAsFixedWidthText(annotations) {
  if (!annotations || !annotations.data || annotations.data.length === 0) return '';

  const headers = Array.from(
    new Set(
      annotations.data
        .flatMap(function (a) {
          return Object.keys(a || {});
        })
        .filter(function (k) {
          return typeof k === 'string';
        })
    )
  );

  const capitalizedHeaders = headers.map(function (h) {
    return h.charAt(0).toUpperCase() + h.slice(1).toLowerCase();
  });

  const rows = annotations.data.map(function (entry) {
    return headers.map(function (key) {
      return entry[key] != null ? String(entry[key]) : '';
    });
  });

  var lines = [];

  lines.push('| ' + capitalizedHeaders.join(' | ') + ' |');
  lines.push(
    '| ' +
      headers
        .map(function () {
          return '---';
        })
        .join(' | ') +
      ' |'
  );

  rows.forEach(function (row) {
    lines.push('| ' + row.join(' | ') + ' |');
  });

  return lines.join('\n');
}

async function addNote(caseId, options, noteBody) {
  const Logger = getLogger();

  const fields = 'notes';

  const requestOptions = {
    uri: `${options.url}/v3/cases/${caseId}`,
    method: 'PUT',
    body: {},
    qs: {
      fields
    }
  };

  requestOptions.body.notes = { data: [noteBody] };

  const noteString = JSON.stringify(requestOptions.body);

  Logger.debug(
    {
      textNodeLength: countTextNodeLength(requestOptions.body),
      commentLength: noteString.length,
      fileSize: getStringSize(noteString)
    },
    `Add Integration Data Comment to Issue ${caseId} Request Options`
  );

  const apiResponse = await polarityRequest.request(requestOptions, options);

  Logger.trace({ apiResponse }, `Add Note to Case ${caseId} response`);

  if (!SUCCESS_CODES.includes(apiResponse.statusCode)) {
    throw new ApiRequestError(
      `Unexpected status code ${apiResponse.statusCode} received when making request to add integration data note to ThreatConnect Case ${caseId}`,
      {
        statusCode: apiResponse.statusCode,
        requestOptions,
        responseBody: apiResponse.body
      }
    );
  }

  return apiResponse.body;
}

function truncateIfNeeded(text, limit) {
  return text.length > limit ? text.slice(0, limit - 3) + '...' : text;
}

function getStringSize(str) {
  const bytes = Buffer.byteLength(str, 'utf8');
  const kilobytes = bytes / 1024;
  const megabytes = bytes / (1024 * 1024);
  return {
    bytes,
    kilobytes,
    megabytes
  };
}

/**
 * Check if an array contains only primitive values (string, number, boolean, null, undefined, symbol, bigint).
 * @param arr
 * @returns {boolean}
 */
function isPrimitiveArray(arr) {
  // First, ensure the input is indeed an array.
  if (!Array.isArray(arr)) {
    return false;
  }

  for (const element of arr) {
    // Check for null explicitly (since typeof null === 'object' in JS).
    if (element === null) {
      continue;
    }
    // If the element is an object or function, it's not primitive.
    const typeOfElement = typeof element;
    if (typeOfElement === 'object' || typeOfElement === 'function') {
      return false;
    }
  }

  // If no non-primitive elements were found, return true.
  return true;
}

/**
 * Check if an object is flat (i.e., it contains only primitive values or arrays of primitive values).
 * @param obj
 * @returns boolean
 */
function isFlatObject(obj) {
  let characterCount = 0;
  // Check that `obj` is a non-null object and not an array
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];

      // If the value is an array, verify it's an array of primitives
      if (Array.isArray(value)) {
        if (!isPrimitiveArray(value)) {
          return false;
        } else {
          // +3 is for a line break and the space and colon we add for each "key: value" pair
          characterCount += value.join(', ').length + key.length + 3;
        }
      }
      // If the value is a non-null object (including date objects, etc.), it's not flat
      else if (value !== null && typeof value === 'object') {
        return false;
      }
      // If it's a function, it's not considered a flat primitive.
      else if (typeof value === 'function') {
        return false;
      } else {
        // If it's a primitive (string, number, boolean, null, symbol, bigint), that's okay
        // +3 is for a line break and the space and colon we add for each "key: value" pair
        characterCount += String(value).length + key.length + 3;
      }
    }
  }
  // If we get here, everything was either a primitive or a primitive array
  return true;
}

/**
 * Check if an object is flat (i.e., it contains only primitive values or arrays of primitive values).
 * @param obj
 * @returns number
 */
function getFlatObjectCharacterCount(obj) {
  let characterCount = 0;

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];

      // If the value is an array count the values joined together
      if (Array.isArray(value)) {
        // +3 is for a line break and the space and colon we add for each "key: value" pair
        characterCount += value.join(', ').length + key.length + 3;
      } else {
        // If it's a primitive (string, number, boolean, null, symbol, bigint), that's okay
        // +3 is for a line break and the space and colon we add for each "key: value" pair
        characterCount += String(value).length + key.length + 3;
      }
    }
  }
  // If we get here, everything was either a primitive or a primitive array
  return characterCount;
}

function countTextNodeLength(jsonObj) {
  let totalTextLength = 0;
  let totalTextWithKeyLength = 0;
  let totalTypeAndTextLength = 0;

  function recurse(obj) {
    if (Array.isArray(obj)) {
      // If it's an array, loop through and recurse on each element
      for (let item of obj) {
        recurse(item);
      }
    } else if (obj !== null && typeof obj === 'object') {
      // If it's an object, check each key-value pair
      for (let key in obj) {
        if (obj.hasOwnProperty(key)) {
          // If the key is 'text' and its value is a string, add its length
          if (key === 'text' && typeof obj[key] === 'string') {
            totalTextLength += String(obj[key]).length;
            totalTypeAndTextLength += String(obj[key]).length;
            totalTextWithKeyLength += key.length + obj[key].length;
          }
          if (key === 'type' && typeof obj[key] === 'string') {
            totalTypeAndTextLength += obj[key].length;
          }
          // Recurse further into the object
          recurse(obj[key]);
        }
      }
    }
    // For anything else (number, string, etc.), do nothing
  }

  recurse(jsonObj);
  return {
    totalTextLength,
    totalTextWithKeyLength,
    totalTypeAndTextLength
  };
}

function removeImageFromString(value) {
  return value.replace(/<svg.+<\/svg>/g, '').replace(/<img.+<\/img>/g, '');
}

/**
 * Attempts to extract the text from a tag as some tags are objects
 * @param tag
 */
function getTagText(tag) {
  if (typeof tag === 'string') {
    return removeImageFromString(tag).trim();
  }

  if (tag && typeof tag === 'object' && typeof tag.text === 'string') {
    return removeImageFromString(tag.text).trim();
  }

  // Fallback if tag is not a string or object with text property
  return 'Tag unavailable';
}

/**
 * Converts the flattened integration data which is in the format
 * ```
 * [
 *   { key: 'a', value: 1 },
 *   { key: 'b.c', value: 2 },
 *   { key: 'b.d.0', value: 3 },
 *   { key: 'b.d.1', value: 4 },
 *   { key: 'e.f.g', value: 5 }
 * ]
 * ```
 * into a Confluence-style expand section with the data inside of it
 * as a table.
 * @param integrationData
 */
function getIntegrationDataExpansion(integration) {
  if (!integration?.data?.details || typeof integration.data.details !== 'object') {
    return { characterCount: 0, lines: [], integrationName: integration.integrationName };
  }

  const flattened = flattenDeepObject(integration.data.details);

  const lines = formatTableFromFlattenedData(flattened);

  return {
    characterCount: lines.join('\n').length,
    lines,
    integrationName: integration.integrationName
  };
}

function flattenDeepObject(obj, parentKey = '') {
  const result = {};

  function recurse(current, keyPath) {
    if (isValueToIgnore(current)) {
      return;
    }

    if (Array.isArray(current)) {
      const filtered = current.filter((item) => !isValueToIgnore(item));
      if (filtered.length === 0) return;

      filtered.forEach((item, index) => {
        recurse(item, `${keyPath}.${index}`);
      });
    } else if (typeof current === 'object' && current !== null) {
      const keys = Object.keys(current).filter((k) => !isValueToIgnore(current[k]));
      if (keys.length === 0) return;

      const isShallow = keys.every((k) => typeof current[k] !== 'object' || current[k] === null);

      if (isShallow) {
        const collapsed = keys.map((k) => `${k}: ${formatValue(current[k])}`).join('<br>');
        if (!isValueToIgnore(collapsed)) {
          result[keyPath] = collapsed;
        }
      } else {
        for (const k of keys) {
          recurse(current[k], keyPath ? `${keyPath}.${k}` : k);
        }
      }
    } else {
      if (!isValueToIgnore(current)) {
        result[keyPath] = formatValue(current);
      }
    }
  }

  recurse(obj, parentKey);
  return result;
}

function formatValue(val) {
  if (Array.isArray(val)) {
    return val.map(formatValue).join(', ');
  }
  if (typeof val === 'object' && val !== null) {
    return JSON.stringify(val);
  }
  return String(val);
}

function formatTableFromFlattenedData(flattenedData, fieldWidth = 300, valueWidth = 300) {
  const lines = [];

  for (const [key, rawValue] of Object.entries(flattenedData)) {
    const truncatedKey = truncateAndEscape(String(key), fieldWidth);

    const raw = formatValue(rawValue);
    const truncatedValue = truncateAndEscape(raw, valueWidth);

    lines.push(`| ${truncatedKey} | ${truncatedValue} |`);
  }

  return lines;
}

function truncateAndEscape(text, maxLength) {
  const clean = text.replace(/\|/g, '\\|');
  return clean.length > maxLength ? clean.slice(0, maxLength - 3) + '...' : clean;
}

function stringIsBase64Image(value) {
  return /^data:image\/[a-zA-Z]*;base64,/.test(value);
}

function stringIsHexColor(value) {
  return /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(value);
}

function isValueToIgnore(value) {
  if (
    value === null ||
    typeof value === 'undefined' ||
    (typeof value === 'string' && value.trim().length === 0) ||
    (Array.isArray(value) && value.every((v) => isValueToIgnore(v))) ||
    (typeof value === 'object' && value !== null && Object.values(value).every((v) => isValueToIgnore(v)))
  ) {
    return true;
  }

  if (typeof value === 'string' && stringIsBase64Image(value.trim())) {
    return true;
  }

  if (typeof value === 'string' && stringIsHexColor(value.trim())) {
    return true;
  }

  return false;
}

/**
 * Convert a JSON object into an array of {key, value} pairs,
 * where 'key' is the dot notation path, and 'value' is the value at that path.
 *
 * This method also tracks the total number of characters being used for the key:value
 * pairs and returns it along with the array of JSON data.
 *
 * @param {Object} obj - The JSON object to flatten.
 * @return {{result: *[], characterCount: *, isTruncated: boolean}} An array of { key, value } pairs.
 */
function jsonToDotNotationArray(obj) {
  const result = [];
  let characterCount = 0;
  let isTruncated = false;

  /**
   * Recursive helper to traverse the object and collect paths/values.
   *
   * @param {any} current - The current sub‐object or value.
   * @param {string} path - The accumulated dot‐notation path so far.
   */
  function traverse(current, path) {
    if (isValueToIgnore(current) || characterCount > MAX_CHARACTER_COUNT_PER_INTEGRATION) {
      return;
    }

    if (current && isPrimitiveArray(current)) {
      // If current is a primitive array we just take the array values and concat them together
      // after ignoring values
      let value = current.filter((value) => !isValueToIgnore(value)).join(', ');
      const tmpCharacterCount = characterCount + value.length + path.length;
      characterCount = tmpCharacterCount;
      result.push({ key: path, value, isPrimitiveArray: true });
    } else if (current && isFlatObject(current)) {
      // Remove values from flat object that should be ignored
      const currentMinusIgnored = Object.keys(current)
        .filter((key) => !isValueToIgnore(current[key]))
        .reduce((obj, key) => {
          obj[key] = current[key];
          return obj;
        }, {});
      const numCharacters = getFlatObjectCharacterCount(currentMinusIgnored);
      const tmpCharacterCount = characterCount + numCharacters + path.length;

      if (characterCount > MAX_CHARACTER_COUNT_PER_INTEGRATION) {
        isTruncated = true;
        return;
      } else {
        characterCount = tmpCharacterCount;
      }
      result.push({ key: path, value: currentMinusIgnored, isFlatObject: true });
    } else if (current && typeof current === 'object') {
      // If current is an object or array, keep traversing its properties.
      for (const key in current) {
        if (Object.prototype.hasOwnProperty.call(current, key)) {
          let newPath = path;
          // Only add the key if it's not an array or if it's an array with more than one element
          if (!Array.isArray(current) || (Array.isArray(current) && current.length > 1)) {
            newPath = path ? `${path}.${key}` : key;
          }
          traverse(current[key], newPath);
        }
      }
    } else {
      // current is a primitive value (string, number, boolean, or null)
      const tmpCharacterCount = characterCount + String(current).length + path.length;

      // If the current data puts us over the max character count, skip it and mark this integration
      // as having truncated data
      if (tmpCharacterCount > MAX_CHARACTER_COUNT_PER_INTEGRATION) {
        isTruncated = true;
        return;
      } else {
        characterCount = tmpCharacterCount;
      }
      result.push({ key: path, value: String(current) });
    }
  }

  traverse(obj, '');
  return { result, characterCount, isTruncated };
}

module.exports = {
  addIntegrationDataAsNote
};
