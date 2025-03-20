"use strict";
polarity.export = PolarityComponent.extend({
  newTagValue: "",
  showFalsePositiveAlreadyReported: false,
  details: Ember.computed.alias("block.data.details"),
  summary: Ember.computed.alias("block.data.summary"),
  indicators: Ember.computed.alias("block.data.details.indicators"),
  results: Ember.computed.alias("details.results"),
  timezone: Ember.computed("Intl", function () {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }),
  playbooks: Ember.computed.alias("details.playbooks"),
  indicatorType: Ember.computed.alias("details.indicatorType"),
  entityValue: Ember.computed.alias("block.entity.value"),
  newCaseTagValues: {},
  onDemand: Ember.computed("block.entity.requestContext.requestType", function () {
    return this.block.entity.requestContext.requestType === "OnDemand";
  }),
  firstIndicator: Ember.computed("indicators.[0]", function () {
    const indicatorOrderById = this.get("details.indicatorOrderById");
    return this.get("indicators")[indicatorOrderById[0]];
  }),
  newTagValues: Ember.computed(() => ({})),
  isExpanded: false,
  pageSize: 10,
  indicatorMessage: "",
  indicatorErrorMessage: "",
  indicatorPlaybookId: null,
  isRunning: false,
  isEditingCases: {},
  newCaseStatusValues: {},
  newCaseSeverityValues: {},
  newCaseResolutionValues: {},
  newCaseDescriptionValues: {},
  newCaseAttributeValues: {},
  caseAttributeTypes: Ember.computed.alias("details.caseAttributeTypes"),
  newCaseAttributes: {},
  newCaseName: "",
  newCaseStatus: "Open",
  newCaseSeverity: "Low",
  associateIndicator: false,
  isCreatingCase: {},
  _flashError: function (msg) {
    this.get("flashMessages").add({
      message: "ThreatConnect: " + msg,
      type: "unv-danger",
      timeout: 3000
    });
  },
  init() {
    let array = new Uint32Array(5);
    this.set("uniqueIdPrefix", window.crypto.getRandomValues(array).join(""));
    if (!this.get("block.detailsLoaded")) {
      this.set("isDetailsLoading", true);
    }
    this._super(...arguments);
  },
  onDetailsLoaded() {
    if (!this.isDestroyed) {
      this.set("isDetailsLoading", false);
      const indicators = this.get("details.indicators");
      const indicatorOrderById = this.get("details.indicatorOrderById");

      if (indicatorOrderById.length > 0) {
        const firstIndicatorById = indicatorOrderById[0];
        this.set(`indicators.${firstIndicatorById}.__show`, true);
      }

      for (const id in indicators) {
        let indicator = indicators[id].indicator;
        indicator.__ratingHuman = this.getRatingHuman(indicator.rating);
        indicator.__confidenceHuman = this.getConfidenceHuman(indicator.confidence);
        indicator.__threatAssessScorePercentage = (indicator.threatAssessScore / 1000) * 100;
        indicator.__threatAssessScoreHuman = this.getScoreHuman(indicator.threatAssessScore);
        indicator.__threatAssesConfidenceHuman = this.getConfidenceHuman(indicator.threatAssessConfidence);
        indicator.__threatAssessRatingHuman = this.getRatingHuman(indicator.threatAssessRating);

        let totalAssociations = 0;
        if (indicator.associatedGroups && indicator.associatedGroups.data) {
          totalAssociations += indicator.associatedGroups.data.length;
        }
        if (indicator.associatedIndicators && indicator.associatedIndicators.data) {
          totalAssociations += indicator.associatedIndicators.data.length;
        }

        indicator.__totalAssociations = totalAssociations;

        if (indicator.associatedCases && indicator.associatedCases.data) {
          indicator.associatedCases.data.forEach((caseObj) => {
            switch (caseObj.severity) {
              case "Critical":
                caseObj.__severityColor = "maroon-text";
                break;
              case "High":
                caseObj.__severityColor = "red-text";
                break;
              case "Medium":
                caseObj.__severityColor = "orange-text";
                break;
              default:
                caseObj.__severityColor = "";
            }
          });
        }
      }
    }
  },
  actions: {
    toggleEdit(caseId, indicatorId) {
      let isEditing = this.get(`isEditingCases.${caseId}`) || false;

      if (isEditing) {
        this.send("saveCaseUpdates", caseId, indicatorId);
      } else {
        this.set(`isEditingCases.${caseId}`, true);
      }
    },
    cancelEdit(caseId) {
      this.set(`isEditingCases.${caseId}`, false);
    },
    toggleCreateCase(indicatorId) {
      let isCreating = this.get(`isCreatingCase.${indicatorId}`) || false;
      this.set(`isCreatingCase.${indicatorId}`, !isCreating);
    },
    saveCaseUpdates(caseId, indicatorId) {
      const newCaseAttributes = this.get("newCaseAttributes") || [];

      const newValues = {
        status: this.get(`newCaseStatusValues.${caseId}`),
        severity: this.get(`newCaseSeverityValues.${caseId}`),
        resolution: this.get(`newCaseResolutionValues.${caseId}`),
        description: this.get(`newCaseDescriptionValues.${caseId}`),
        attributes: { data: newCaseAttributes[caseId] }
      };

      let indicatorPath = `indicators.${indicatorId}.indicator.associatedCases.data`;
      const casesArray = this.get(indicatorPath);
      const caseToUpdate = casesArray.find((c) => c.id === caseId);
      if (caseToUpdate) {
        this.set(`${indicatorPath}.${casesArray.indexOf(caseToUpdate)}.__updating`, true);
      }

      const payload = {
        action: "UPDATE_CASE",
        caseId,
        mode: "append"
      };

      Object.assign(payload, Object.fromEntries(Object.entries(newValues).filter(([_, value]) => value)));

      if (Object.values(newValues).some((value) => value)) {
        this.sendIntegrationMessage(payload)
          .then((result) => {
            if (result.error) {
              console.error("Error", result.error);
              this._flashError(result.error.detail, "error");
            } else {
              this.set("actionMessage", "Case updated successfully");

              Object.entries(newValues).forEach(([key, value]) => {
                if (value) {
                  this.set(`${indicatorPath}.${casesArray.indexOf(caseToUpdate)}.${key}`, value);
                }
              });

              if (result.data && result.data.attributes && result.data.attributes.data) {
                let updatedAttributes = result.data.attributes.data;
                this.set(`${indicatorPath}.${casesArray.indexOf(caseToUpdate)}.attributes.data`, updatedAttributes);
              }
            }
          })
          .finally(() => {
            this.setProperties({
              [`newCaseStatusValues.${caseId}`]: null,
              [`newCaseSeverityValues.${caseId}`]: null,
              [`newCaseResolutionValues.${caseId}`]: null,
              [`newCaseDescriptionValues.${caseId}`]: null,
              [`newCaseAttributeValues.${caseId}`]: null
            });
            this.set(`${indicatorPath}.${casesArray.indexOf(caseToUpdate)}.__updating`, false);
          });
        this.set(`isEditingCases.${caseId}`, false);
      } else {
        this.set(`isEditingCases.${caseId}`, false);
      }
    },
    updateStatus(caseId, event) {
      let newValue = event.target.value;
      this.set(`newCaseStatusValues.${caseId}`, newValue);
    },
    updateSeverity(caseId, event) {
      let newValue = event.target.value;
      this.set(`newCaseSeverityValues.${caseId}`, newValue);
    },
    updateResolution(caseId, event) {
      let newValue = event.target.value;
      this.set(`newCaseResolutionValues.${caseId}`, newValue);
    },
    updateDescription(caseId, event) {
      let newValue = event.target.value;
      this.set(`newCaseDescriptionValues.${caseId}`, newValue);
    },
    updateAttributes(caseId, event) {
      let parsedValue = JSON.parse(event.target.value);
      let newValue = { type: parsedValue.name, value: parsedValue.description };

      let newCaseAttributes = Object.assign({}, this.get("newCaseAttributes"));

      if (!newCaseAttributes[caseId]) {
        newCaseAttributes[caseId] = [];
      }

      let existingAttributes = newCaseAttributes[caseId];
      if (!existingAttributes.some((attr) => attr.type === newValue.type && attr.value === newValue.value)) {
        existingAttributes.push(newValue);
      }

      newCaseAttributes[caseId] = existingAttributes;

      this.set("newCaseAttributes", newCaseAttributes);

      this.set(`newCaseAttributeValues.${caseId}`, JSON.stringify(parsedValue));
    },
    removeAttribute(caseId, index) {
      let newCaseAttributes = this.get("newCaseAttributes") || {};

      if (newCaseAttributes[caseId]) {
        let updatedAttributes = newCaseAttributes[caseId].filter((_, i) => i !== index);

        let updatedCaseAttributes = { newCaseAttributes };

        if (updatedAttributes.length === 0) {
        } else {
          updatedCaseAttributes[caseId] = updatedAttributes;
        }

        this.set("newCaseAttributes", updatedCaseAttributes);
      }
    },
    // Create New Case Functionality
    updateNewCaseName(event) {
      this.set("newCaseName", event.target.value);
    },
    updateNewCaseSeverity(event) {
      this.set("newCaseSeverity", event.target.value);
    },
    updateNewCaseStatus(event) {
      this.set("newCaseStatus", event.target.value);
    },
    toggleAssociateIndicator(event) {
      this.set("associateIndicator", event.target.checked);
    },
    createCase(indicatorId) {
      const name = this.get("newCaseName");
      if (!name) {
        this._flashError("Name is required", "error");
        return;
      }

      const payload = {
        action: "CREATE_CASE",
        name: name,
        severity: this.get("newCaseSeverity"),
        status: this.get("newCaseStatus"),
        associateIndicator: this.get("associateIndicator"),
        indicatorId: indicatorId
      };

      this.sendIntegrationMessage(payload)
        .then((result) => {
          if (result.error) {
            console.error("Result Error", result.error);
            this._flashError(result.error.detail, "error");
          } else {
            this.set("actionMessage", "Case created successfully");
          }
        })
        .finally(() => {
          this.setProperties({
            ["newCaseName"]: "",
            ["newCaseSeverity"]: "Low",
            ["newCaseStatus"]: "Open",
            ["associateIndicator"]: false
          });
        });
    },
    expandTags() {
      this.toggleProperty("isExpanded");
    },
    toggleIsExpanded(organizationData) {
      Ember.set(organizationData, "isExpanded", !organizationData.isExpanded);
    },
    stopPropagation: function (e) {
      e.stopPropagation();
      return false;
    },
    changeTab: function (tabName, indicatorId) {
      this.set(`indicators.${indicatorId}.__activeTab`, tabName);

      if (
        tabName === "cases" &&
        typeof this.get(`indicators.${indicatorId}.indicator.associatedCases`) === "undefined"
      ) {
        this.getField(indicatorId, "associatedCases");
      } else if (
        tabName === "groups" &&
        typeof this.get(`indicators.${indicatorId}.indicator.associatedGroups`) === "undefined"
      ) {
        this.getField(indicatorId, "associatedGroups");
      } else if (
        tabName === "indicators" &&
        typeof this.get(`indicators.${indicatorId}.indicator.associatedIndicators`) === "undefined"
      ) {
        this.getField(indicatorId, "associatedIndicators");
      } else if (tabName === "whois" && typeof this.get(`indicators.${indicatorId}.indicator.whois`) === "undefined") {
        this.getField(indicatorId, "whois");
      } else if (
        tabName === "dnsResolution" &&
        typeof this.get(`indicators.${indicatorId}.indicator.dnsResolution`) === "undefined"
      ) {
        this.getField(indicatorId, "dnsResolution");
      }
    },
    saveConfidence(indicatorId) {
      this.set(`indicators.${indicatorId}.__savingConfidence`, true);

      const payload = {
        action: "UPDATE_INDICATOR",
        indicatorId,
        field: "confidence",
        value: this.get(`indicators.${indicatorId}.indicator.__shadowConfidence`)
      };

      this.sendIntegrationMessage(payload)
        .then((result) => {
          if (result.error) {
            console.error(result.error);
            this._flashError(result.error.detail, "error");

            let originalValue = this.get(`indicators.${indicatorId}.indicator.confidence`);
            // Note: this is a trick to get the property observers to fire so we can reset the
            // slider value.  We have to change the value to trigger observers
            this.set(`indicators.${indicatorId}.indicator.confidence`, originalValue + 1);
            this.set(`indicators.${indicatorId}.indicator.confidence`, originalValue);
          } else {
            this.set(`indicators.${indicatorId}.indicator.confidence`, result.data.confidence);
            this.set(
              `indicators.${indicatorId}.indicator.__confidenceHuman`,
              this.getConfidenceHuman(result.data.confidence)
            );
          }
        })
        .finally(() => {
          this.set(`indicators.${indicatorId}.__savingConfidence`, false);
        });
    },
    addTag(indicatorId) {
      const newTag = this.get(`newTagValues.${indicatorId}`) || this.get("newTagValue");
      if (!newTag || newTag.length === 0) {
        this.set("actionMessage", "You must enter a tag");
        return;
      }

      this.set(`indicators.${indicatorId}.__updatingTags`, true);

      const payload = {
        action: "UPDATE_TAG",
        indicatorId,
        tag: newTag,
        mode: "append"
      };

      this.sendIntegrationMessage(payload)
        .then((result) => {
          if (result.error) {
            console.error(result.error);
            this._flashError(result.error.detail, "error");
          } else {
            this.set("actionMessage", "Added Tag");
            this.set(`indicators.${indicatorId}.indicator.tags`, result.data);
          }
        })
        .finally(() => {
          this.setProperties({
            newTagValues: {},
            newTagValue: ""
          });
          this.set(`indicators.${indicatorId}.__updatingTags`, false);
        });
    },
    updateCaseTagValue(caseId, event) {
      this.set(`newCaseTagValues.${caseId}`, event.target.value);
    },
    addCaseTag(caseId, indicatorId) {
      const newTag = this.get(`newCaseTagValues.${caseId}`).trim();
      if (!newTag) {
        this.set("actionMessage", "You must enter a tag");
        return;
      }
      let indicatorPath = `indicators.${indicatorId}.indicator.associatedCases.data`;
      const casesArray = this.get(indicatorPath);

      const caseToUpdate = casesArray.find((c) => c.id === caseId);
      if (caseToUpdate) {
        this.set(`${indicatorPath}.${casesArray.indexOf(caseToUpdate)}.__updatingTags`, true);
      }

      const payload = {
        action: "UPDATE_CASE_TAG",
        caseId,
        tag: newTag,
        mode: "append"
      };

      this.sendIntegrationMessage(payload)
        .then((result) => {
          if (result.error) {
            console.error("Result Error", result.error);
            this._flashError(result.error.detail, "error");
          } else {
            this.set("actionMessage", "Added Tag");
            this.set(`${indicatorPath}.${casesArray.indexOf(caseToUpdate)}.tags`, result.data.tags);
          }
        })
        .finally(() => {
          this.set(`newCaseTagValues.${caseId}`, "");
          this.set(`${indicatorPath}.${casesArray.indexOf(caseToUpdate)}.__updatingTags`, false);
        });
    },
    deleteTag(indicatorId, tagToRemove) {
      this.set(`indicators.${indicatorId}.__updatingTags`, true);

      const payload = {
        action: "UPDATE_TAG",
        indicatorId,
        tag: tagToRemove,
        mode: "delete"
      };

      this.sendIntegrationMessage(payload)
        .then((result) => {
          if (result.error) {
            console.error(result.error);
            this._flashError(result.error.detail, "error");
          } else {
            const updatedTags = this.get(`indicators.${indicatorId}.indicator.tags.data`).filter(
              (tag) => tag.name !== tagToRemove
            );
            this.set(`indicators.${indicatorId}.indicator.tags.data`, updatedTags);
          }
        })
        .finally(() => {
          this.set(`indicators.${indicatorId}.__updatingTags`, false);
        });
    },
    reportFalsePositive(indicatorId) {
      console.info("Report False Positive", indicatorId);
      this.set(`indicators.${indicatorId}.__savingFalsePositive`, true);

      const payload = {
        action: "REPORT_FALSE_POSITIVE",
        entity: this.get("block.entity"),
        owner: this.get(`indicators.${indicatorId}.indicator.ownerName`)
      };

      this.sendIntegrationMessage(payload)
        .then((result) => {
          if (result.error) {
            console.error(result.error);
            this._flashError(result.error.detail, "error");
          } else {
            if (this.get(`indicators.${indicatorId}.indicator.falsePositives`) === result.data.count) {
              this.set(`indicators.${indicatorId}.indicator.__showFalsePositiveAlreadyReported`, true);
            } else {
              this.set(`indicators.${indicatorId}.indicator.__showFalsePositiveAlreadyReported`, false);
            }
            this.set(`indicators.${indicatorId}.indicator.lastFalsePositive`, result.data.lastReported);
            this.set(`indicators.${indicatorId}.indicator.falsePositives`, result.data.count);
          }
        })
        .finally(() => {
          this.set(`indicators.${indicatorId}.__savingFalsePositive`, false);
        });
    },
    setRating(indicatorId, rating) {
      this.set(`indicators.${indicatorId}.__savingRating`, true);
      const payload = {
        action: "UPDATE_INDICATOR",
        field: "rating",
        value: rating,
        indicatorId
      };

      this.sendIntegrationMessage(payload)
        .then((result) => {
          if (result.error) {
            console.error(result.error);
            this._flashError(result.error.detail, "error");
          } else {
            this.set("actionMessage", "Set rating to : " + result.data.rating);
            this.set(`details.indicators.${indicatorId}.indicator.rating`, result.data.rating);
            this.set(
              `details.indicators.${indicatorId}.indicator.__ratingHuman`,
              this.getRatingHuman(result.data.rating)
            );
          }
        })
        .finally(() => {
          this.set(`indicators.${indicatorId}.__savingRating`, false);
        });
    },
    prevPage(indicatorId, field) {
      let currentPage = this.get(`indicators.${indicatorId}.indicator.__${field}CurrentPage`);

      if (currentPage > 1) {
        this.set(`indicators.${indicatorId}.indicator.__${field}CurrentPage`, currentPage - 1);
      }
    },
    nextPage(indicatorId, field) {
      const totalFieldResults = this.get(`indicators.${indicatorId}.indicator.${field}.data.length`);
      const totalPages = Math.ceil(totalFieldResults / this.pageSize);
      let currentPage = this.get(`indicators.${indicatorId}.indicator.__${field}CurrentPage`);
      if (currentPage < totalPages) {
        this.set(`indicators.${indicatorId}.indicator.__${field}CurrentPage`, currentPage + 1);
        console.info("Current Page", currentPage + 1);
      }
    },
    firstPage(indicatorId, field) {
      this.set(`indicators.${indicatorId}.indicator.__${field}CurrentPage`, 1);
    },
    lastPage(indicatorId, field) {
      const totalFieldResults = this.get(`indicators.${indicatorId}.indicator.${field}.data.length`);
      const totalPages = Math.ceil(totalFieldResults / this.pageSize);
      this.set(`indicators.${indicatorId}.indicator.__${field}CurrentPage`, totalPages);
    },
    getField(indicatorId, field) {
      this.getField(indicatorId, field);
    }
  },
  getScoreHuman(score) {
    if (score >= 801) {
      return "critical";
    }
    if (score >= 501) {
      return "high";
    }

    if (score >= 201) {
      return "medium";
    }

    return "low";
  },
  getRatingHuman(rating) {
    if (rating === 0) {
      return "Unknown";
    }
    if (rating <= 1) {
      return "Suspicious";
    }
    if (rating <= 2) {
      return "Low";
    }
    if (rating <= 3) {
      return "Moderate";
    }
    if (rating <= 4) {
      return "High";
    }
    if (rating <= 5) {
      return "Critical";
    }
    return "Unknown";
  },
  getConfidenceHuman(confidence) {
    if (!confidence || confidence === 0) {
      return "Unassessed";
    }

    if (confidence <= 25) {
      return "Improbable";
    }

    if (confidence <= 49) {
      return "Doubtful";
    }

    if (confidence <= 69) {
      return "Possible";
    }

    if (confidence <= 89) {
      return "Probable";
    }

    return "Confirmed";
  },
  getField(indicatorId, field) {
    this.set(`indicators.${indicatorId}.__${field}Loading`, true);
    const payload = {
      action: "GET_INDICATOR_FIELD",
      field,
      indicatorId
    };

    this.sendIntegrationMessage(payload)
      .then((result) => {
        if (result.error) {
          console.error(result.error);
          this._flashError(result.error.detail, "error");
        } else if (result.data && typeof result.data[field] !== "undefined") {
          this.set(`indicators.${indicatorId}.indicator.${field}`, result.data[field]);
          if (result.data[field].data) {
            this.set(`indicators.${indicatorId}.indicator.__${field}Count`, result.data[field].data.length);

            // setup a filtered data set, initialize the starting page to 1
            this.set(`indicators.${indicatorId}.indicator.__${field}CurrentPage`, 1);

            Ember.defineProperty(
              this.get(`indicators.${indicatorId}.indicator`),
              `__${field}PrevButtonDisabled`,
              Ember.computed(`__${field}CurrentPage`, () => {
                return this.get(`indicators.${indicatorId}.indicator.__${field}CurrentPage`) === 1;
              })
            );

            Ember.defineProperty(
              this.get(`indicators.${indicatorId}.indicator`),
              `__${field}NextButtonDisabled`,
              Ember.computed(`__${field}CurrentPage`, `${field}.data.length`, () => {
                const currentPage = this.get(`indicators.${indicatorId}.indicator.__${field}CurrentPage`);
                const totalItems = this.get(`indicators.${indicatorId}.indicator.${field}.data.length`);
                const totalPages = Math.ceil(totalItems / this.pageSize);
                return currentPage === totalPages;
              })
            );

            Ember.defineProperty(
              this.get(`indicators.${indicatorId}.indicator`),
              `__${field}Filtered`,
              Ember.computed(`${field}.data.length`, `__${field}CurrentPage`, () => {
                let totalItems = this.get(`indicators.${indicatorId}.indicator.${field}.data.length`);
                let currentPage = this.get(`indicators.${indicatorId}.indicator.__${field}CurrentPage`);
                const startIndex = (currentPage - 1) * this.pageSize;
                const endIndex = startIndex + this.pageSize > totalItems ? totalItems : startIndex + this.pageSize;

                // Can't use set in a computed unless we ensure it only happens once per render
                Ember.run.scheduleOnce(
                  "afterRender",
                  this,
                  this.setStartEndIndexes,
                  indicatorId,
                  field,
                  startIndex + 1,
                  endIndex
                );

                return this.get(`indicators.${indicatorId}.indicator.${field}.data`).slice(startIndex, endIndex);
              })
            );

            // This notify property change is required as the computed will not be flagged as dirty
            // for the template until one of the dependent properties changes.
            this.notifyPropertyChange(`${field}${indicatorId}Filtered`);
            this.notifyPropertyChange(`${field}${indicatorId}PrevButtonDisabled`);
            this.notifyPropertyChange(`${field}${indicatorId}NextButtonDisabled`);
          } else {
            this.set(`details.indicators.${indicatorId}.indicator.__${field}Count`, 0);
          }
        }
      })
      .catch((err) => {
        console.error("getField Error", err);
        if (err.status === "504") {
          this.set(`indicators.${indicatorId}.indicator.__${field}Timeout`, true);
        }
      })
      .finally(() => {
        this.set(`indicators.${indicatorId}.__${field}Loading`, false);
      });
  },
  setStartEndIndexes: function (indicatorId, field, startIndex, endIndex) {
    this.set(`indicators.${indicatorId}.indicator.__${field}StartItem`, startIndex);
    this.set(`indicators.${indicatorId}.indicator.__${field}EndItem`, endIndex);
  }
});
