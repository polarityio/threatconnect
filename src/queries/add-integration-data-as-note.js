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

    Logger.info('Character Count for Integration Data', characterCount);

    const integrationLines = [];

    // Header: appears only in the first chunk of this integration
    const headerLines = [`### Integration: ${integration.integrationName}`];
    if (Array.isArray(integration.data.summary)) {
      for (const tag of integration.data.summary) {
        headerLines.push(`- ${getTagText(tag)}`);
      }
    }
    headerLines.push(''); // spacer

    Logger.info(`Raw line count: ${rawLines.length}`);
    Logger.info(`Raw char count: ${rawLines.reduce((acc, l) => acc + l.length, 0)}`);
    // With this:
    const TABLE_HEADER = ['Field | Value', '----- | -----'];
    const linesWithHeaders = [TABLE_HEADER.join('\n'), ...rawLines, '\n---\n'];
    const chunks = splitLinesByCharacterLimit(linesWithHeaders, MAX_CHARACTER_COUNT_PER_INTEGRATION);

    Logger.info(`Chunk count: ${chunks.length}`);
    chunks.forEach((chunk, i) =>
      Logger.debug({ index: i, charCount: chunk.length, preview: chunk.slice(0, 3) }, 'Chunk preview')
    );

    // Remove header from second+ chunks to avoid duplication
    for (let i = 0; i < chunks.length; i++) {
      const chunk = [...chunks[i]];
      const finalChunk = [];

      // Add Integration title and summary tags only in first chunk
      if (i === 0) {
        finalChunk.push(...headerLines);
      }

      // Always add table headers
      finalChunk.push(...TABLE_HEADER);

      // Then the actual content (excluding old headers if present)
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

  // Add Annotations (at the very end, if present)
  if (annotations && annotations.data?.length) {
    const annotationText = formatAnnotationsAsFixedWidthText(payload.annotations, 300);
    allNoteChunks.push(['### Polarity Annotations', '', ...annotationText.split('\n')]);
  }

  Logger.info(`Total flattened lines across integrations: ${allNoteChunks.flat().length}`);
  Logger.info(`Total note chunks: ${allNoteChunks.length}`);

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
    const lineLength = line.length + 1; // +1 for newline

    // Split the line itself if it's longer than maxChars
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

  // Get unique headers dynamically
  const headers = Array.from(
    new Set(annotations.data.flatMap((a) => Object.keys(a || {})).filter((k) => typeof k === 'string'))
  );

  const rows = annotations.data.map((entry) => headers.map((key) => (entry[key] != null ? String(entry[key]) : '')));

  // Determine natural column widths (longest word per column)
  const columnWidths = headers.map((_, i) => Math.max(headers[i].length, ...rows.map((row) => row[i]?.length || 0)));

  const pad = (text, width) => text.padEnd(width, ' ');

  const lines = [];

  // Header with Sentence Case
  const headerLabels = headers.map((h) => h.charAt(0).toUpperCase() + h.slice(1).toLowerCase());
  lines.push(headerLabels.map((h, i) => pad(h, columnWidths[i])).join(' | '));
  lines.push(columnWidths.map((w) => '-'.repeat(w)).join('-|-'));

  // Rows
  for (const row of rows) {
    lines.push(row.map((cell, i) => pad(cell, columnWidths[i])).join(' | '));
  }

  return lines.join('\n');
}

async function addNote(caseId, options, noteBody) {
  const Logger = getLogger();

  const requestOptions = {
    uri: `${options.url}/v3/cases/${caseId}`,
    method: 'PUT',
    body: {}
  };

  requestOptions.body.notes = { data: [noteBody] };

  const noteString = JSON.stringify(requestOptions.body);

  Logger.debug(
    {
      //requestOptions,
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

function flattenContentDataToText(contentData) {
  if (!contentData) return [];
  if (Array.isArray(contentData)) {
    return contentData.map((block) => flattenSingleBlock(block)).flat();
  } else {
    return flattenSingleBlock(contentData);
  }
}

function flattenSingleBlock(block) {
  if (!block) return [];

  switch (block.type) {
    case 'paragraph':
      return [block.content?.map((node) => node.text).join('') || ''];
    case 'heading':
      const level = block.attrs?.level || 3;
      const hashes = '#'.repeat(level);
      return [`${hashes} ${block.content?.map((n) => n.text).join('') || ''}`];
    case 'rule':
      return ['---'];
    case 'expand':
      return flattenContentDataToText(block.content);
    case 'table':
      return flattenTable(block);
    case 'panel':
      return flattenContentDataToText(block.content);
    default:
      return [];
  }
}

function flattenTable(table) {
  const lines = [];
  for (const row of table.content || []) {
    const cells = row.content || [];
    const rowText = cells
      .map((cell) =>
        (cell.content || []).map((paragraph) => paragraph.content?.map((n) => n.text).join('') || '').join(' ')
      )
      .join(' | ');
    lines.push(rowText);
  }
  return lines;
}

function formatAnnotationsAsText(annotations) {
  return annotations.data
    .map((a) => `- ${a.tag} (Channel: ${a.channel}, User: ${a.user}, Applied: ${a.applied})`)
    .join('\n');
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

function getTags(tags) {
  if (Array.isArray(tags) && tags.length === 0) {
    tags.push('No summary tags available');
  }

  return {
    type: 'paragraph',
    content: [
      ...tags
        .map((tag) => {
          return [
            {
              type: 'text',
              text: getTagText(tag),
              marks: [
                {
                  type: 'code'
                }
              ]
            },
            {
              type: 'text',
              text: ' '
            }
          ];
        })
        .flat()
    ]
  };
}

function getPanel(text, type = 'info') {
  return {
    type: 'panel',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: text
          }
        ]
      }
    ],
    attrs: {
      panelType: type
    }
  };
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

  // Ensure table formatting is done here before splitting
  const lines = formatTableFromFlattenedData(flattened); // ⬅️ This ensures every chunk gets table lines

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
        const collapsed = keys.map((k) => `${k}: ${formatValue(current[k])}`).join('');
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

function formatTableFromFlattenedData(flattenedData) {
  const lines = [];

  const entries = Object.entries(flattenedData);
  if (entries.length === 0) return lines;

  const fieldWidth = Math.max(...entries.map(([key]) => key.length), 5); // min width: "Field"
  const header = `${'Field'.padEnd(fieldWidth)} | Value`;
  const divider = `${'-'.repeat(fieldWidth)}-|-------`;

  lines.push(header);
  lines.push(divider);

  for (const [key, value] of entries) {
    lines.push(`${key.padEnd(fieldWidth)} | ${value}`);
  }

  return lines;
}

/**
 * Check if a value is empty (null, undefined, empty string, or empty array).
 * @param value
 * @returns {boolean}
 */
function isEmptyValue(value) {
  return (
    value === null ||
    typeof value === 'undefined' ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'string' && value.trim().length === 0)
  );
}

/**
 * Get a table row for a flat object (i.e., an object where every value is a primitive value and there is no nesting).
 * For Flat objects we format the entire into the table cell as key: value pairs just like in integration details block.
 * The key is colored in a light gray and the value is the default color (black).
 * @param data
 * @returns {{type: string, content: [{type: string, attrs: {}, content: [{type: string, content: [{type: string, text}]}]},{type: string, attrs: {}, content: [{type: string, content: FlatArray<([{type: string, text: string, marks: [{type: string, attrs: {color: string}}]},{type: string, text: string}]|undefined)[], 1>[]}]}]}}
 */
function getFlatObjectTableRow(data) {
  const row = {
    type: 'tableRow',
    content: [
      {
        type: 'tableCell',
        attrs: {},
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: data.key
              }
            ]
          }
        ]
      },
      {
        type: 'tableCell',
        attrs: {},
        content: [
          {
            type: 'paragraph',
            content: [
              // data.value is a flat object (i.e., every value is a primitive value and there is no nesting)
              ...Object.keys(data.value)
                .map((key, index) => {
                  // We don't want to
                  if (!isValueToIgnore(data.value[key])) {
                    const line = [
                      {
                        type: 'text',
                        text: key,
                        marks: [
                          {
                            type: 'textColor',
                            attrs: {
                              color: '#97a0af'
                            }
                          }
                        ]
                      },
                      {
                        type: 'text',
                        text: `: ${data.value[key]}`
                      }
                    ];
                    // Ensure no line break for the last key-value pair
                    if (index !== Object.keys(data.value).length - 1) {
                      line.push({
                        type: 'hardBreak'
                      });
                    }
                    return line;
                  }
                  return [];
                })
                .flat()
            ]
          }
        ]
      }
    ]
  };

  if (row.content[1].content[0].content.length === 0) {
    // returning an empty object will leave this out of the note
    return [];
  }

  return row;
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
