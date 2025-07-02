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

  const dataToPush = integrationData.map((integration, index) => {
    const { characterCount, contentData } = getIntegrationDataExpansion(integration);

    Logger.info('Character Count for Integration Data', characterCount);

    const lines = [
      `### Integration: ${integration.integrationName}`,
      ...(Array.isArray(integration.data.summary) ? integration.data.summary.map((tag) => `- ${getTagText(tag)}`) : []),
      '',
      contentData
    ];

    if (index !== integrationData.length - 1) {
      lines.push('\n---\n');
    }

    return {
      characterCount: lines.join('\n').length,
      text: lines.join('\n'),
      integrationName: integration.integrationName
    };
  });

  if (annotations && annotations.data?.length) {
    const text = (formatted = formatAnnotationsAsFixedWidthText(payload.annotations));

    dataToPush.push({
      characterCount: text.length,
      text,
      integrationName: 'Polarity Annotations'
    });
  }

  const noteGroups = groupIntegrationDataToTarget(
    dataToPush,
    MAX_CHARACTER_COUNT_PER_INTEGRATION,
    MAX_CHARACTER_COUNT_PER_INTEGRATION
  );
  Logger.info(`Grouped integration data into ${noteGroups.length} notes`);
  const debugStructure = noteGroups.map((group) => group.map((integration) => integration.integrationName));
  Logger.debug({ debugStructure }, 'Integration Data Grouping');

  const newlyCreatedNotes = [];

  await async.eachOfLimit(noteGroups, 1, async (group, index) => {
    const noteText = [
      `(${index + 1} of ${noteGroups.length}) Polarity Integration Data – added via Polarity`,
      '',
      ...group.map((integration) => integration.text)
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
  let characterCount;
  let text;
  let isTruncated = false;

  let plainDetails;

  try {
    // Convert details to plain JSON to remove getter/setter functions
    plainDetails = JSON.parse(JSON.stringify(integration.data.details));
  } catch (e) {
    getLogger().warn({ error: e }, 'Could not stringify integration.data.details');
    plainDetails = null;
  }

  if (plainDetails) {
    const { result, characterCount: count, isTruncated: truncated } = jsonToDotNotationArray(plainDetails);
    characterCount = count;
    isTruncated = truncated;
    text = formatIntegrationDetailsAsFixedWidthText(plainDetails, MAX_CHARACTER_COUNT_PER_INTEGRATION);
  } else {
    text = 'No data was returned from the integration';
    characterCount = text.length;
  }

  return {
    characterCount,
    contentData: text,
    integrationName: integration.integrationName
  };
}

function formatIntegrationDetailsAsFixedWidthText(integrationData, maxCharCount = MAX_CHARACTER_COUNT_PER_INTEGRATION) {
  const flatData = jsonToDotNotationArray(integrationData);

  const rows = flatData.result.map((entry) => [entry.key, formatFlatValue(entry.value)]);
  const headers = ['Field', 'Value'];

  const columnWidths = headers.map((_, colIndex) =>
    Math.max(headers[colIndex].length, ...rows.map((row) => row[colIndex]?.length || 0))
  );

  const pad = (text, width) => text.padEnd(width, ' ');

  const lines = [];

  // Header
  lines.push(headers.map((h, i) => pad(h, columnWidths[i])).join(' | '));
  lines.push(columnWidths.map((w) => '-'.repeat(w)).join('-|-'));

  // Rows
  for (const row of rows) {
    const line = row.map((cell, i) => pad(cell, columnWidths[i])).join(' | ');
    const projectedLength = lines.join('\n').length + line.length + 1;
    if (projectedLength > maxCharCount) {
      lines.push('... (truncated due to length)');
      break;
    }
    lines.push(line);
  }

  return lines.join('\n');
}

function formatFlatValue(value) {
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value)
      .filter(([k, v]) => !isValueToIgnore(v))
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
  }
  return String(value);
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

function getNestedOrPrimitiveTableRow(data) {
  return {
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
              {
                type: 'text',
                text: data.value
              }
            ]
          }
        ]
      }
    ]
  };
}

function getHeading3(heading) {
  return {
    type: 'heading',
    attrs: {
      level: 3
    },
    content: [
      {
        type: 'text',
        text: heading
      }
    ]
  };
}

function getHeading1(heading) {
  return {
    type: 'heading',
    attrs: {
      level: 2
    },
    content: [
      {
        type: 'text',
        text: heading,
        marks: [
          {
            type: 'textColor',
            attrs: {
              color: '#0747a6'
            }
          }
        ]
      }
    ]
  };
}

function defangEntity(entity) {
  if (entity.isIP) {
    const lastDotIndex = entity.value.lastIndexOf('.');
    return entity.value.slice(0, lastDotIndex) + '[.]' + entity.value.slice(lastDotIndex + 1);
  } else if (entity.isDomain) {
    return entity.value.replace(/\./g, '[.]');
  } else if (entity.isUrl) {
    return entity.value.replace(/^http/, 'hxxp').replace(/\./g, '[.]');
  } else {
    return entity.value;
  }
}

function getIntegrationTableHeader() {
  return {
    type: 'tableRow',
    content: [
      {
        type: 'tableHeader',
        attrs: {},
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Field',
                marks: [
                  {
                    type: 'strong'
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        type: 'tableHeader',
        attrs: {},
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Value',
                marks: [
                  {
                    type: 'strong'
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

function stringIsBase64Image(value) {
  return /^data:image\/[a-zA-Z]*;base64,/.test(value);
}

function stringIsHexColor(value) {
  return /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(value);
}

function isValueToIgnore(value) {
  if (isEmptyValue(value)) {
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

  function traverse(current, path) {
    if (isValueToIgnore(current) || characterCount > MAX_CHARACTER_COUNT_PER_INTEGRATION) return;

    // Case 1: Primitive array → join into comma-separated string
    if (Array.isArray(current) && isPrimitiveArray(current)) {
      const value = current.filter((v) => !isValueToIgnore(v)).join(', ');
      const tmpCount = characterCount + value.length + path.length;
      if (tmpCount > MAX_CHARACTER_COUNT_PER_INTEGRATION) {
        isTruncated = true;
        return;
      }
      characterCount = tmpCount;
      result.push({ key: path, value, isPrimitiveArray: true });
      return;
    }

    // Case 2: Array of objects → add as-is by index, don't traverse inside
    if (Array.isArray(current) && current.length && typeof current[0] === 'object') {
      for (let i = 0; i < current.length; i++) {
        const value = current[i];
        const newPath = `${path}.${i}`;
        const tmpCount = characterCount + JSON.stringify(value).length + newPath.length;
        if (tmpCount > MAX_CHARACTER_COUNT_PER_INTEGRATION) {
          isTruncated = true;
          return;
        }
        characterCount = tmpCount;
        result.push({ key: newPath, value });
      }
      return;
    }

    // Case 3: Flat object → show inside cell
    if (isFlatObject(current)) {
      const trimmed = Object.keys(current)
        .filter((k) => !isValueToIgnore(current[k]))
        .reduce((obj, k) => {
          obj[k] = current[k];
          return obj;
        }, {});
      const tmpCount = characterCount + getFlatObjectCharacterCount(trimmed) + path.length;
      if (tmpCount > MAX_CHARACTER_COUNT_PER_INTEGRATION) {
        isTruncated = true;
        return;
      }
      characterCount = tmpCount;
      result.push({ key: path, value: trimmed, isFlatObject: true });
      return;
    }

    // Case 4: Nested object → recurse
    if (typeof current === 'object' && current !== null) {
      for (const key in current) {
        if (!current.hasOwnProperty(key)) continue;
        const newPath = path ? `${path}.${key}` : key;
        traverse(current[key], newPath);
      }
      return;
    }

    // Case 5: Primitive value
    const tmpCount = characterCount + String(current).length + path.length;
    if (tmpCount > MAX_CHARACTER_COUNT_PER_INTEGRATION) {
      isTruncated = true;
      return;
    }
    characterCount = tmpCount;
    result.push({ key: path, value: current });
  }

  traverse(obj, '');

  return { result, characterCount, isTruncated };
}

/**
 * Bin packing method which takes an array of numbers and a target sum, and groups the numbers into
 * as few groups as possible such that the sum of each group is less than or equal to the target sum.
 *
 * @param numbers
 * @param target
 * @returns {any[]}
 */
function groupIntegrationDataToTarget(integrationData, firstBinTarget, target) {
  // Sort descending
  integrationData.sort((a, b) => b.characterCount - a.characterCount);

  // Each element of 'bins' will be an object: { sum: <number>, items: <array> }
  const bins = [];

  // For every number, try to fit it into a bin
  for (const integration of integrationData) {
    let count = integration.characterCount;
    let placed = false;

    // Try to place `num` in the first bin where it fits
    for (let i = 0; i < bins.length; i++) {
      const bin = bins[i];
      let tmpTarget = target;

      // if this is the first bin, then use firstBinTarget because we need to leave
      // room to add in our comment
      if (i === 0) {
        tmpTarget = firstBinTarget;
      }

      if (bin.sum + count <= tmpTarget) {
        bin.items.push(integration);
        bin.sum += count;
        placed = true;
        break;
      }
    }

    // If we couldn't place it in any existing bin, create a new one
    if (!placed) {
      bins.push({ sum: count, items: [integration] });
    }
  }

  // Extract just the array of items from each bin
  return bins.map((bin) => bin.items);
}

module.exports = {
  addIntegrationDataAsNote
};
