/*
 * Copyright (c) 2025, Polarity.io, Inc.
 */

const async = require('async');
const polarityRequest = require('../polarity-request');
const { ApiRequestError } = require('../errors');
const { getLogger } = require('../logger');
const SUCCESS_CODES = [201];
const MAX_CHARACTER_COUNT_PER_INTEGRATION = 60000;

/**
 *
 * @param caseId
 * @param data - object containing the userName, userEmail, and integration data
 * @param options
 * @returns {Promise<*>}
 */
async function addIntegrationDataAsNote(payload, options) {
  const Logger = getLogger();
  const integrationData = payload.integrationData || [];
  const annotations = payload.annotations || [];

  const dataToPush = integrationData
    .map((integration, index) => {
      const { characterCount, contentData } = getIntegrationDataExpansion(integration);

      const noteData = [getHeading3(integration.integrationName), getTags(integration.data.summary), contentData];

      // Add the divider but not for the last integration
      if (index !== integrationData.length - 1) {
        noteData.push({
          type: 'rule'
        });
      }

      return {
        characterCount,
        contentData: noteData,
        integrationName: integration.integrationName
      };
    })
    .flat();

  if (annotations) {
    dataToPush.push({
      characterCount: JSON.stringify(annotations).length,
      contentData: getAnnotations(annotations),
      integrationName: 'Polarity Annotations'
    });
  }

  let firstBinTarget = MAX_CHARACTER_COUNT_PER_INTEGRATION;
  if (comment) {
    firstBinTarget = MAX_CHARACTER_COUNT_PER_INTEGRATION - comment.length;
  }

  const noteGroups = groupIntegrationDataToTarget(dataToPush, firstBinTarget, MAX_CHARACTER_COUNT_PER_INTEGRATION);

  const debugStructure = [];
  noteGroups.forEach((group) => {
    debugStructure.push(group.map((integration) => integration.integrationName));
  });

  Logger.debug({ debugStructure }, 'Integration Data Grouping');

  const newlyCreatedNotes = [];
  // We need to reverse the noteGroups so that the first group which has extra space for a note
  // now comes at the end so that we can add our note to it and have it appear first
  // on the Case Notes page.  This is meant to support the default sort order which is
  // to display the most recent note first (i.e., the first note we had becomes the last ntoe so we
  // need the last note we add to be the first).
  noteGroups.reverse();
  await async.eachOfLimit(noteGroups, 1, async (group, index) => {
    const content = [];

    // If the user wanted to add some regular comment text, we add it to the first comment
    // Remember comments appear in reverse order which is why we add it to the last comment in
    // the array.
    if (comment && index === noteGroups.length - 1) {
      content.push({
        content: [
          {
            text: comment,
            type: 'text'
          }
        ],
        type: 'paragraph'
      });
    }

    content.push(
      getPanel(
        `(${noteGroups.length - index} of ${
          noteGroups.length
        }) Polarity Integration Data – the following information was added via Polarity`
      )
    );
    content.push(getHeading1(defangEntity(entity)));
    content.push(...group.map((integration) => integration.contentData).flat());

    const noteContent = {
      body: {
        content,
        type: 'doc',
        version: 1
      }
    };

    const addedNote = await addNote(payload.caseId, options, noteContent);
    newlyCreatedNotes.unshift(addedNote);
  });

  return newlyCreatedNotes;
}

async function addNote(caseId, options, noteContent) {
  const Logger = getLogger();

  const requestOptions = {
    uri: `${options.url}/v3/cases/${caseId}`,
    method: 'PUT',
    body: {}
  };

  requestOptions.body.notes = { data: [{ text: noteContent }] };

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

function getAnnotations(annotations) {
  if (annotations) {
    return [
      getHeading3('Annotations'),
      getTags(annotations.data.map((annotation) => annotation.tag)),
      {
        type: 'expand',
        content: [
          {
            type: 'table',
            attrs: {
              isNumberColumnEnabled: false,
              layout: 'align-start'
            },
            content: [
              getAnnotationsTableHeader(),
              ...annotations.data
                .map((annotation) => {
                  return [
                    {
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
                                  text: annotation.tag
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
                                  text: annotation.channel
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
                                  text: annotation.user
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
                                  text: annotation.applied
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ];
                })
                .flat()
            ]
          }
        ],
        attrs: {
          title: 'Annotations'
        }
      }
    ];
  } else {
    return [];
  }
}

function getAnnotationsTableHeader() {
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
                text: 'Annotation',
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
                text: 'Channel',
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
                text: 'User',
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
                text: 'Applied',
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
  let flattenedData;
  let characterCount;
  let isTruncated = false;
  if (integration && integration.data && integration.data.details) {
    const result = jsonToDotNotationArray(integration.data.details);
    flattenedData = result.result;
    characterCount = result.characterCount;
    isTruncated = result.isTruncated;
  } else {
    flattenedData = [
      {
        key: 'No Data',
        value: 'No data was returned from the integration'
      }
    ];
    characterCount = 'No Data'.length + 'No data was returned from the integration'.length;
  }

  getLogger().debug({ characterCount, name: integration.integrationName }, 'Character Count for Integration Data');

  const tableRows = flattenedData
    .map((data) => {
      if (data.isFlatObject) {
        return getFlatObjectTableRow(data);
      } else {
        return getNestedOrPrimitiveTableRow(data);
      }
    })
    .flat();

  const content = [];

  if (isTruncated) {
    content.push(
      getPanel(
        `Data from ${integration.integrationName} was truncated to fit within the character limit of 15,000 characters`,
        'warning'
      )
    );
  }

  content.push({
    type: 'table',
    attrs: {
      isNumberColumnEnabled: false,
      layout: 'align-start'
    },
    content: [getIntegrationTableHeader(isTruncated), ...tableRows]
  });

  return {
    characterCount,
    contentData: {
      type: 'expand',
      content: content,
      attrs: {
        title: integration.integrationName
      }
    }
  };
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
      if (characterCount > MAX_CHARACTER_COUNT_PER_INTEGRATION) {
        isTruncated = true;
        return;
      } else {
        characterCount = tmpCharacterCount;
      }
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
