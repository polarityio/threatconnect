'use strict';
polarity.export = PolarityComponent.extend({
  newTagValue: '',
  showFalsePositiveAlreadyReported: false,
  details: Ember.computed.alias('block.data.details'),
  summary: Ember.computed.alias('block.data.summary'),
  indicators: Ember.computed.alias('block.data.details.indicators'),
  results: Ember.computed.alias('details.results'),
  timezone: Ember.computed('Intl', function () {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }),
  playbooks: Ember.computed.alias('details.playbooks'),
  indicatorType: Ember.computed.alias('details.indicatorType'),
  entityValue: Ember.computed.alias('block.entity.value'),
  newCaseTagValues: {},
  onDemand: Ember.computed('block.entity.requestContext.requestType', function () {}),
  firstIndicator: Ember.computed('indicators.[0]', function () {
    const indicatorOrderById = this.get('details.indicatorOrderById');
    return this.get('indicators')[indicatorOrderById[0]];
  }),
  tagsCount: Ember.computed('indicators.@each.tags', function () {
    let indicators = this.get('indicators');
    let totalTags = 0;

    Object.keys(indicators).forEach((indicatorId) => {
      let tags = this.get(`indicators.${indicatorId}.indicator.tags.data`);
      if (Array.isArray(tags)) {
        totalTags += tags.length;
      }
    });

    return totalTags;
  }),
  newTagValues: Ember.computed(() => ({})),
  isExpanded: false,
  pageSize: 10,
  associatedCasesPageSize: 3,
  indicatorMessage: '',
  indicatorErrorMessage: '',
  indicatorPlaybookId: null,
  isRunning: false,
  isCreatingCase: {},
  newCaseFields: {},
  isDescription: false,
  notificationsData: Ember.inject.service('notificationsData'),
  displayNoteFieldsForCase(caseObj) {
    const projectId = caseObj.__state.selectedProjectId;
    const issueType = caseObj.__state.selectedIssueType;

    const isValidProject = projectId != null && projectId !== '' && typeof projectId !== 'undefined';
    const isValidIssueType = issueType != null && issueType !== '' && typeof issueType !== 'undefined';

    return isValidProject && isValidIssueType;
  },
  flashMessage(message, type = 'info') {
    this.flashMessages.add({
      message: `${this.block.acronym}: ${message}`,
      type: `unv-${type}`,
      icon: type === 'success' ? 'check-circle' : type === 'danger' ? 'exclamation-circle' : 'info-circle',
      timeout: 3000
    });
  },
  applyStatusColorToCase(caseObj) {
    switch (caseObj.status) {
      case 'Open':
        Ember.set(caseObj, '__statusColor', 'green-text');
        break;
      case 'Closed':
        Ember.set(caseObj, '__statusColor', 'red-text');
        break;
      default:
        Ember.set(caseObj, '__statusColor', '');
    }
  },
  applySeverityColorToCase(caseObj) {
    switch (caseObj.severity) {
      case 'Critical':
        Ember.set(caseObj, '__severityColor', 'maroon-text');
        break;
      case 'High':
        Ember.set(caseObj, '__severityColor', 'red-text');
        break;
      case 'Medium':
        Ember.set(caseObj, '__severityColor', 'orange-text');
        break;
      default:
        Ember.set(caseObj, '__severityColor', '');
    }
  },
  init() {
    let array = new Uint32Array(5);
    this.set('uniqueIdPrefix', window.crypto.getRandomValues(array).join(''));
    if (!this.get('block.detailsLoaded')) {
      this.set('isDetailsLoading', true);
    }
    this.set('newCaseFields', {});
    this._super(...arguments);
  },
  onDetailsLoaded() {
    if (!this.isDestroyed) {
      this.set('isDetailsLoading', false);
      const indicators = this.get('details.indicators');
      const indicatorOrderById = this.get('details.indicatorOrderById');

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
      }
    }
  },
  actions: {
    toggleEdit(caseId, indicatorId) {
      const indicatorPath = `indicators.${indicatorId}.indicator.associatedCases.data`;
      const casesArray = this.get(indicatorPath);
      const caseToEdit = casesArray.find((c) => c.id === caseId);

      if (!caseToEdit) return;

      const caseIndex = casesArray.indexOf(caseToEdit);

      const isEditing = this.get(`${indicatorPath}.${caseIndex}.__isEditing`) || false;

      if (isEditing) {
        this.send('saveCaseUpdates', caseId, indicatorId);
      } else {
        this.set(`${indicatorPath}.${caseIndex}.__isEditing`, true);
      }
    },
    cancelEdit(caseId, indicatorId) {
      const indicatorPath = `indicators.${indicatorId}.indicator.associatedCases.data`;
      const casesArray = this.get(indicatorPath);
      const caseToEdit = casesArray.find((c) => c.id === caseId);

      if (!caseToEdit) return;

      const caseIndex = casesArray.indexOf(caseToEdit);

      this.set(`${indicatorPath}.${caseIndex}.__isEditing`, false);
    },
    saveCaseUpdates(caseId, indicatorId) {
      const indicatorPath = `indicators.${indicatorId}.indicator.associatedCases.data`;
      const casesArray = this.get(indicatorPath);
      const caseToUpdate = casesArray.find((c) => c.id === caseId);

      if (!caseToUpdate) return;

      const caseIndex = casesArray.indexOf(caseToUpdate);

      this.set(`${indicatorPath}.${caseIndex}.__updating`, true);
      this.set(`${indicatorPath}.${caseIndex}.__isSaving`, true);

      const newValues = {
        status: caseToUpdate.__newStatus,
        severity: caseToUpdate.__newSeverity,
        resolution: caseToUpdate.__newResolution,
        description: caseToUpdate.__newDescription,
        attributes: { data: caseToUpdate.__newAttributes }
      };

      const filteredValues = {};
      Object.entries(newValues).forEach(([key, value]) => {
        if (value) {
          filteredValues[key] = value;
        }
      });

      const payload = {
        action: 'UPDATE_CASE',
        caseId,
        mode: 'append'
      };

      Object.assign(payload, filteredValues);

      const shouldUpdate = Object.values(newValues).some((value) => value);

      if (shouldUpdate) {
        this.sendIntegrationMessage(payload)
          .then((result) => {
            if (result.error) {
              console.error('Error', result.error);
              this.flashMessage(`${result.error.detail}`, 'danger');
            } else {
              this.flashMessage(`Case with ID ${result.data.id} updated successfully`, 'success');

              this.set(`${indicatorPath}.${caseIndex}.__successMessage`, 'Case updated successfully');

              Object.entries(newValues).forEach(([key, value]) => {
                if (value) {
                  this.set(`${indicatorPath}.${caseIndex}.${key}`, value);
                }
              });

              if (result.data.attributes.data) {
                this.set(`${indicatorPath}.${caseIndex}.attributes.data`, result.data.attributes.data);
              }

              const caseUpdated = this.get(`${indicatorPath}.${caseIndex}`);
              this.applySeverityColorToCase(caseUpdated);
              this.applyStatusColorToCase(caseUpdated);
            }
          })
          .finally(() => {
            this.setProperties({
              [`${indicatorPath}.${caseIndex}.__newStatus`]: null,
              [`${indicatorPath}.${caseIndex}.__newSeverity`]: null,
              [`${indicatorPath}.${caseIndex}.__newResolution`]: null,
              [`${indicatorPath}.${caseIndex}.__newDescription`]: null,
              [`${indicatorPath}.${caseIndex}.__newAttributes`]: null,
              [`${indicatorPath}.${caseIndex}.__isEditing`]: false,
              [`${indicatorPath}.${caseIndex}.__updating`]: false,
              [`${indicatorPath}.${caseIndex}.__isSaving`]: false
            });
          });
      } else {
        this.set(`${indicatorPath}.${caseIndex}.__isEditing`, false);
        this.set(`${indicatorPath}.${caseIndex}.__updating`, false);
      }
    },
    updateAttributes(caseId, indicatorId, event) {
      const parsedValue = JSON.parse(event.target.value);
      const newValue = { type: parsedValue.name, value: parsedValue.description };

      const indicatorPath = `indicators.${indicatorId}.indicator.associatedCases.data`;
      const casesArray = this.get(indicatorPath);
      const caseToUpdate = casesArray.find((c) => c.id === caseId);

      if (!caseToUpdate) return;

      if (!this.get(`${indicatorPath}.${casesArray.indexOf(caseToUpdate)}.__newAttributes`)) {
        this.set(`${indicatorPath}.${casesArray.indexOf(caseToUpdate)}.__newAttributes`, Ember.A([]));
      }

      this.get(`${indicatorPath}.${casesArray.indexOf(caseToUpdate)}.__newAttributes`).pushObject(newValue);
    },
    removeAttribute(caseId, indicatorId, index) {
      const indicatorPath = `indicators.${indicatorId}.indicator.associatedCases.data`;
      const casesArray = this.get(indicatorPath);
      const caseToUpdate = casesArray.find((c) => c.id === caseId);

      if (!caseToUpdate || !caseToUpdate.__newAttributes) return;

      const updatedAttributes = caseToUpdate.__newAttributes.filter((_, i) => i !== index);

      Ember.set(caseToUpdate, '__newAttributes', updatedAttributes);
    },
    updateNewCaseField(indicatorId, field, event) {
      const value = field === 'associateIndicator' ? event.target.checked : event.target.value;
      const path = `indicators.${indicatorId}.indicator.__newCase`;

      this.set(`${path}.${field}`, value);
      this.notifyPropertyChange(path);
    },
    toggleCreateCase(indicatorId) {
      let isCreating = this.get(`isCreatingCase.${indicatorId}`) || false;
      this.set(`isCreatingCase.${indicatorId}`, !isCreating);

      if (!isCreating) {
        const path = `indicators.${indicatorId}.indicator.__newCase`;

        this.set(path, {
          name: '',
          description: '',
          status: 'Open',
          severity: 'Low',
          notes: '',
          associateIndicator: true,
          __error: false,
          __errorMessage: '',
          __required: ['name']
        });

        this.set(`newCaseFields.${indicatorId}`, [
          {
            key: 'name',
            name: 'Name',
            required: true,
            __value: '',
            __error: false,
            __errorMessage: ''
          },
          {
            key: 'description',
            name: 'Description',
            required: false,
            __value: '',
            __error: false,
            __errorMessage: ''
          },
          {
            key: 'notes',
            name: 'Notes',
            required: false,
            __value: '',
            __error: false,
            __errorMessage: ''
          },
          {
            key: 'tags',
            name: 'Tags',
            required: false,
            __value: '',
            __error: false,
            __errorMessage: ''
          }
        ]);

        this.notifyPropertyChange(path);

        const payload = {
          action: 'GET_WORKFLOW_TEMPLATES'
        };

        this.set(`${path}.__isLoadingTemplates`, true);

        this.sendIntegrationMessage(payload)
          .then((response) => {
            this.set(`${path}.workflowTemplates`, response.workflowTemplates);
          })
          .catch((error) => {
            console.error('Failed to fetch workflow templates', error);
            this.flashMessage(`${error.detail}`, 'danger');
            this.set(`${path}.workflowTemplates`, []);
            this.set(`${path}.workflowTemplates.__error`, true);
            this.set(`${path}.workflowTemplates.__errorMessage`, JSON.stringify(error, null, 2));
          })
          .finally(() => {
            this.set(`${path}.__isLoadingTemplates`, false);
          });
      }
    },
    clearErrorField(indicatorId, pathToField) {
      const fullPath = `indicators.${indicatorId}.indicator.__newCase.${pathToField}`;
      if (this.get(fullPath)) {
        this.set(`${fullPath}.__error`, false);
        this.set(`${fullPath}.__errorMessage`, '');
      }
    },
    onWorkflowTemplateChange(indicatorId, workflowId) {
      const path = `indicators.${indicatorId}.indicator.__newCase`;
      const templates = this.get(`${path}.workflowTemplates`) || [];

      if (workflowId === 'none') {
        this.set(`${path}.__selectedWorkflowData`, null);
        this.set(`${path}.__templateDescriptionMismatch`, false);
        this.set(`${path}.description`, '');
      } else {
        const selectedWorkflow = templates.find((t) => t.id.toString() === workflowId);

        if (selectedWorkflow) {
          const currentDescription = this.get(`${path}.description`) || '';

          if (
            currentDescription &&
            currentDescription.trim().length > 0 &&
            currentDescription !== selectedWorkflow.description
          ) {
            this.set(`${path}.__selectedWorkflowData`, selectedWorkflow);
            this.set(`${path}.__templateDescriptionMismatch`, true);
          } else {
            this.set(`${path}.description`, selectedWorkflow.description || '');
            this.set(`${path}.__selectedWorkflowData`, selectedWorkflow);
            this.set(`${path}.__templateDescriptionMismatch`, false);
          }
        } else {
          this.set(`${path}.description`, '');
          this.set(`${path}.__selectedWorkflowData`, null);
          this.set(`${path}.__templateDescriptionMismatch`, false);
        }
      }
    },
    createCase(indicatorId, event) {
      event.preventDefault();

      const indicatorPath = `indicators.${indicatorId}.indicator`;
      const newCasePath = `${indicatorPath}.__newCase`;
      let newCase = this.get(newCasePath) || {};

      const name = newCase.name ? newCase.name.trim() : '';
      const workflowTemplateId = newCase.__selectedWorkflowData;
      const tags = newCase.tags || '';
      const description = newCase.description || '';
      const severity = newCase.severity || 'Low';
      const status = newCase.status || 'Open';
      const notes = newCase.notes || '';
      const associate = newCase.associateIndicator;

      if (!name) {
        this.set(`${newCasePath}.__error`, true);
        this.set(`${newCasePath}.__errorMessage`, 'Name is required');
        return;
      }

      const payload = {
        action: 'CREATE_CASE',
        name,
        description,
        tags,
        severity,
        status,
        notes,
        associateIndicator: associate,
        indicatorId
      };

      if (workflowTemplateId) {
        payload.workflowTemplateId = workflowTemplateId.id;
      }

      this.set(`${indicatorPath}.__isCreatingCase`, true);

      this.sendIntegrationMessage(payload)
        .then((result) => {
          if (result.error) {
            console.error('Result Error', result.error);
            this.flashMessage(`${result.error.detail}`, 'danger');
          } else {
            this.flashMessage(`Case with ID ${result.data.id} created successfully`, 'success');

            let cases = this.get(`${indicatorPath}.associatedCases.data`);
            if (associate) {
              cases.unshiftObject(result.data);
              this.notifyPropertyChange(`${indicatorPath}.associatedCases.data`);
            }
            const createdCase = cases.find((caseObj) => caseObj.id === result.data.id);

            if (createdCase) {
              this.applySeverityColorToCase(createdCase);
              this.applyStatusColorToCase(createdCase);
            }

            this.set(`${indicatorPath}.__newCase.__successMessage`, 'Case created successfully');

            this.send('toggleCreateCase', indicatorId);
          }
        })
        .finally(() => {
          const newCaseReset = this.get(newCasePath);
          if (newCaseReset) {
            Ember.set(newCaseReset, 'name', '');
            Ember.set(newCaseReset, '__selectedWorkflowData', null);
            Ember.set(newCaseReset, '__templateDescriptionMismatch', false);
            Ember.set(newCaseReset, 'description', '');
            Ember.set(newCaseReset, 'tags', '');
            Ember.set(newCaseReset, 'severity', 'Low');
            Ember.set(newCaseReset, 'status', 'Open');
            Ember.set(newCaseReset, 'notes', '');
            Ember.set(newCaseReset, 'associateIndicator', false);
            Ember.set(newCaseReset, '__error', false);
            Ember.set(newCaseReset, '__errorMessage', null);
            Ember.set(newCaseReset, '__required', ['name']);
          }

          this.set(`${indicatorPath}.__isCreatingCase`, false);
          this.notifyPropertyChange(newCasePath);
        });
    },
    toggleNoteExpansion(caseId, indicatorId, noteIndex) {
      const indicatorPath = `indicators.${indicatorId}.indicator.associatedCases.data`;
      const casesArray = this.get(indicatorPath);
      const caseObj = casesArray.find((c) => c.id === caseId);
      if (!caseObj || !caseObj.notes || !caseObj.notes.data) return;
      const caseIndex = casesArray.indexOf(caseObj);
      const notePath = `${indicatorPath}.${caseIndex}.notes.data.${noteIndex}`;
      const isExpanded = this.get(`${notePath}.__isExpanded`) || false;
      this.set(`${notePath}.__isExpanded`, !isExpanded);
    },
    checkNoteOverflow(caseId, indicatorId) {
      Ember.run.scheduleOnce('afterRender', this, () => {
        setTimeout(() => {
          const indicatorPath = `indicators.${indicatorId}.indicator.associatedCases.data`;
          const casesArray = this.get(indicatorPath);
          const caseObj = casesArray.find((c) => c.id === caseId);
          if (!caseObj || !caseObj.notes || !caseObj.notes.data) return;

          const caseIndex = casesArray.indexOf(caseObj);

          caseObj.notes.data.forEach((note, noteIndex) => {
            const el = document.querySelector(`[data-note-id="note-${caseId}-${noteIndex}"]`);
            if (el) {
              const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
              const maxHeight = 2 * lineHeight;

              const isOverflowing = el.scrollHeight > maxHeight;

              this.set(`${indicatorPath}.${caseIndex}.notes.data.${noteIndex}.__showToggle`, isOverflowing);
            }
          });
        }, 30);
      });
    },
    expandTags() {
      this.toggleProperty('isExpanded');
    },
    toggleIsExpanded(organizationData) {
      Ember.set(organizationData, 'isExpanded', !organizationData.isExpanded);
    },
    stopPropagation: function (e) {
      e.stopPropagation();
      return false;
    },
    changeTab: async function (tabName, indicatorId) {
      this.set(`indicators.${indicatorId}.__activeTab`, tabName);
      if (
        tabName === 'cases' &&
        typeof this.get(`indicators.${indicatorId}.indicator.associatedCases`) === 'undefined'
      ) {
        await this.getField(indicatorId, 'associatedCases');
        const casesArray = this.get(`indicators.${indicatorId}.indicator.associatedCases.data`);
        casesArray.forEach((caseObj, i) => {
          this.applySeverityColorToCase(caseObj);
          this.applyStatusColorToCase(caseObj);

          if (!caseObj.__state) {
            Ember.set(caseObj, '__state', {
              showIntegrationData: false,
              integrations: [],
              numSelectedWriteIntegrations: 0,
              spinRefresh: false
            });
          }
          Ember.set(caseObj.__state, 'displayNoteFields', this.displayNoteFieldsForCase(caseObj));
        });

        Ember.run.scheduleOnce('afterRender', this, () => {
          casesArray.forEach((caseObj) => {
            this.send('checkNoteOverflow', caseObj.id, indicatorId);
          });
        });
      } else if (
        tabName === 'groups' &&
        typeof this.get(`indicators.${indicatorId}.indicator.associatedGroups`) === 'undefined'
      ) {
        this.getField(indicatorId, 'associatedGroups');
      } else if (
        tabName === 'indicators' &&
        typeof this.get(`indicators.${indicatorId}.indicator.associatedIndicators`) === 'undefined'
      ) {
        this.getField(indicatorId, 'associatedIndicators');
      } else if (tabName === 'whois' && typeof this.get(`indicators.${indicatorId}.indicator.whois`) === 'undefined') {
        this.getField(indicatorId, 'whois');
      } else if (
        tabName === 'dnsResolution' &&
        typeof this.get(`indicators.${indicatorId}.indicator.dnsResolution`) === 'undefined'
      ) {
        this.getField(indicatorId, 'dnsResolution');
      }
    },
    saveConfidence(indicatorId) {
      this.set(`indicators.${indicatorId}.__savingConfidence`, true);

      const payload = {
        action: 'UPDATE_INDICATOR',
        indicatorId,
        field: 'confidence',
        value: this.get(`indicators.${indicatorId}.indicator.__shadowConfidence`)
      };

      this.sendIntegrationMessage(payload)
        .then((result) => {
          if (result.error) {
            console.error(result.error);
            this.flashMessage(`${result.error.detail}`, 'danger');

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
      const newTag = this.get(`newTagValues.${indicatorId}`) || this.get('newTagValue');
      if (!newTag || newTag.length === 0) {
        this.set('actionMessage', 'You must enter a tag');
        return;
      }

      this.set(`indicators.${indicatorId}.__updatingTags`, true);

      const payload = {
        action: 'UPDATE_TAG',
        indicatorId,
        tag: newTag,
        mode: 'append'
      };

      this.sendIntegrationMessage(payload)
        .then((result) => {
          if (result.error) {
            console.error(result.error);
            this.flashMessage(`${result.error.detail}`, 'danger');
          } else {
            this.set('actionMessage', 'Added Tag');
            this.set(`indicators.${indicatorId}.indicator.tags`, result.data);
            this.notifyPropertyChange(`indicators.${indicatorId}.indicator.tags`);
            this.notifyPropertyChange('tagsCount');
          }
        })
        .finally(() => {
          this.setProperties({
            newTagValues: {},
            newTagValue: ''
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
        this.set('actionMessage', 'You must enter a tag');
        return;
      }
      let indicatorPath = `indicators.${indicatorId}.indicator.associatedCases.data`;
      const casesArray = this.get(indicatorPath);

      const caseToUpdate = casesArray.find((c) => c.id === caseId);
      if (caseToUpdate) {
        this.set(`${indicatorPath}.${casesArray.indexOf(caseToUpdate)}.__updatingTags`, true);
      }

      const payload = {
        action: 'UPDATE_CASE_TAG',
        caseId,
        tag: newTag,
        mode: 'append'
      };

      this.sendIntegrationMessage(payload)
        .then((result) => {
          if (result.error) {
            console.error('Result Error', result.error);
            this.flashMessage(`${result.error.detail}`, 'danger');
          } else {
            this.set('actionMessage', 'Added Tag');
            this.set(`${indicatorPath}.${casesArray.indexOf(caseToUpdate)}.tags`, result.data.tags);
          }
        })
        .finally(() => {
          this.set(`newCaseTagValues.${caseId}`, '');
          this.set(`${indicatorPath}.${casesArray.indexOf(caseToUpdate)}.__updatingTags`, false);
        });
    },
    deleteTag(indicatorId, tagToRemove) {
      this.set(`indicators.${indicatorId}.__updatingTags`, true);

      const payload = {
        action: 'UPDATE_TAG',
        indicatorId,
        tag: tagToRemove,
        mode: 'delete'
      };

      this.sendIntegrationMessage(payload)
        .then((result) => {
          if (result.error) {
            console.error(result.error);
            this.flashMessage(`${result.error.detail}`, 'danger');
          } else {
            const updatedTags = this.get(`indicators.${indicatorId}.indicator.tags.data`).filter(
              (tag) => tag.name !== tagToRemove
            );
            this.set(`indicators.${indicatorId}.indicator.tags.data`, updatedTags);
            this.notifyPropertyChange('tagsCount');
          }
        })
        .finally(() => {
          this.set(`indicators.${indicatorId}.__updatingTags`, false);
        });
    },
    reportFalsePositive(indicatorId) {
      console.info('Report False Positive', indicatorId);
      this.set(`indicators.${indicatorId}.__savingFalsePositive`, true);

      const payload = {
        action: 'REPORT_FALSE_POSITIVE',
        entity: this.get('block.entity'),
        owner: this.get(`indicators.${indicatorId}.indicator.ownerName`)
      };

      this.sendIntegrationMessage(payload)
        .then((result) => {
          if (result.error) {
            console.error(result.error);
            this.flashMessage(`${result.error.detail}`, 'danger');
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
        action: 'UPDATE_INDICATOR',
        field: 'rating',
        value: rating,
        indicatorId
      };

      this.sendIntegrationMessage(payload)
        .then((result) => {
          if (result.error) {
            console.error(result.error);
            this.flashMessage(`${result.error.detail}`, 'danger');
          } else {
            this.set('actionMessage', 'Set rating to : ' + result.data.rating);
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
      const pageSize = this.get(`${field}PageSize`) || this.pageSize;
      const totalPages = Math.ceil(totalFieldResults / pageSize);
      let currentPage = this.get(`indicators.${indicatorId}.indicator.__${field}CurrentPage`);
      if (currentPage < totalPages) {
        this.set(`indicators.${indicatorId}.indicator.__${field}CurrentPage`, currentPage + 1);
        console.info('Current Page', currentPage + 1);
      }
    },
    firstPage(indicatorId, field) {
      this.set(`indicators.${indicatorId}.indicator.__${field}CurrentPage`, 1);
    },
    lastPage(indicatorId, field) {
      const totalFieldResults = this.get(`indicators.${indicatorId}.indicator.${field}.data.length`);
      const pageSize = this.get(`${field}PageSize`) || this.pageSize;
      const totalPages = Math.ceil(totalFieldResults / pageSize);
      this.set(`indicators.${indicatorId}.indicator.__${field}CurrentPage`, totalPages);
    },
    getField(indicatorId, field) {
      this.getField(indicatorId, field);
    },
    setIntegrationSelection(caseObj) {
      let integrationData = this.getIntegrationData();
      let annotations = this.getAnnotations();

      if (Array.isArray(annotations) && annotations.length > 0) {
        integrationData.unshift({
          integrationName: 'Polarity Annotations',
          data: annotations,
          selected: false,
          isAnnotations: true
        });
      }

      if (!caseObj.__state) {
        Ember.set(caseObj, '__state', {});
      }

      Ember.set(caseObj.__state, 'integrations', integrationData);
      Ember.set(caseObj.__state, 'numSelectedWriteIntegrations', this.getNumSelectedIntegration(integrationData));
    },
    toggleAllIntegrations(caseObj) {
      if (!caseObj.__state) {
        Ember.set(caseObj, '__state', {
          integrations: [],
          numSelectedWriteIntegrations: 0,
          showIntegrationData: false,
          spinRefresh: false
        });
      }

      const integrations = caseObj.__state.integrations || [];
      const hasUnselected = integrations.some((int) => !int.selected);

      integrations.forEach((integration) => {
        Ember.set(integration, 'selected', hasUnselected);
      });

      this.setNumSelectedIntegrationsForCase(caseObj);
    },
    addNoteIntegrationSelected(caseObj) {
      this.setNumSelectedIntegrations(caseObj);
    },
    toggleCaseIntegrationCheckbox(caseObj, event) {
      console.log('Got here 1');
      const checked = event.target.checked;

      Ember.set(caseObj.__state, 'showIntegrationData', checked);

      if (checked) {
        this.refreshIntegrationsForCase(caseObj);
      }
    },
    createNote(caseObj) {
      const state = caseObj.__state;

      // this.clearErrorsForCase(caseObj);

      const includeIntegrationData = state.showIntegrationData;
      let selectedIntegrations = [];
      let annotations;

      if (state.integrations) {
        console.log('INTEGRATIONS', state.integrations);
        selectedIntegrations = state.integrations.filter(
          (integration) => integration.selected && !integration.isAnnotations
        );
        annotations = state.integrations.find((integration) => integration.selected && integration.isAnnotations);
      }

      if (includeIntegrationData && selectedIntegrations.length === 0 && !annotations) {
        Ember.set(state, 'missingIntegrations', true);
        return;
      }

      console.log('ANNOTATIONS', annotations);
      console.log('SELECTED INTEGRATIONS', selectedIntegrations);
      console.log('Obj id', caseObj);
      Ember.set(state, 'isCreatingNote', true);

      const payload = {
        action: 'ADD_INTEGRATION_DATA_AS_NOTE',
        caseId: caseObj.id,
        mode: 'append',
        includeIntegrationData
      };

      if (includeIntegrationData) {
        payload.integrationData = selectedIntegrations;
        payload.annotations = annotations;
      }

      this.sendIntegrationMessage(payload)
        .then((result) => {
          console.log('Result', result);
          this.flashMessage(`Note created successfully for case ${caseObj.id}`, 'success');
          Ember.set(state, 'lastCreatedNote', result.note);
          Ember.set(state, 'showCreateNote', false);
        })
        .catch((e) => {
          console.error('Failed to create note', e);
          this.flashMessage('Failed to create note', 'danger');
          Ember.set(state, 'errorMessage', JSON.stringify(e, null, 2));
          Ember.set(state, 'errorTitle', 'Failed to create note');
        })
        .finally(() => {
          Ember.set(state, 'isCreatingNote', false);
        });
    },
    clearCreateNoteFields(caseObj) {
      const issueFields = caseObj.__state.issueFields;

      if (Array.isArray(issueFields)) {
        issueFields.forEach((field) => {
          if (field.__isRendered && field.__value) {
            field.__value = '';
          }
        });
      }
      Ember.set(caseObj.__state, 'missingIntegrations', false);
      Ember.set(caseObj.__state, 'errorMessage', '');
      Ember.set(caseObj.__state, 'errorTitle', '');
      Ember.set(caseObj.__state, 'shortErrorMessage', '');
    },
    toggleShowCreateNote(caseObj) {
      Ember.set(caseObj.__state, 'showCreateNote', !caseObj.__state.showCreateNote);
    },
    cancelIntegrationNote(caseObj) {
      Ember.set(caseObj.__state, 'showIntegrationData', false);
      this.send('clearCreateNoteFields', caseObj);
    }
  },
  refreshIntegrationsForCase(caseObj) {
    console.log('Got here 2');
    const integrationData = this.getIntegrationData();
    const annotations = this.getAnnotations();
    console.log('INTEGRATION DATA', integrationData);
    if (Array.isArray(annotations) && annotations.length > 0) {
      integrationData.unshift({
        integrationName: 'Polarity Annotations',
        data: annotations,
        selected: false,
        isAnnotations: true
      });
    }

    Ember.set(caseObj.__state, 'integrations', integrationData);
    Ember.set(caseObj.__state, 'numSelectedWriteIntegrations', 0);
  },
  setIssueState: function (issueIndex, key, value) {
    if (!this.get(`pagedPagingData.${issueIndex}.__state`)) {
      this.set(`pagedPagingData.${issueIndex}.__state`, {});
    }
    this.set(`pagedPagingData.${issueIndex}.__state.${key}`, value);
  },
  getIntegrationData: function () {
    const notificationList = this.notificationsData.getNotificationList();
    const integrationBlocks = notificationList.findByValue(this.get('block.entity.value').toLowerCase());
    return integrationBlocks.blocks.reduce((accum, block) => {
      if (block.integrationName !== this.get('block.integrationName') && block.type !== 'polarity') {
        accum.push({
          integrationName: block.integrationName,
          data: block.data,
          selected: false
        });
      }
      return accum;
    }, []);
  },
  getAnnotations: function () {
    const notificationList = this.notificationsData.getNotificationList();
    const integrationBlocks = notificationList.findByValue(this.get('block.entity.value').toLowerCase());
    const polarityBlock = integrationBlocks.blocks.find((block) => {
      if (block.type === 'polarity') {
        return block;
      }
    });
    if (polarityBlock) {
      let annotations = [];
      polarityBlock.tagEntityPairs.forEach((pair) => {
        annotations.push({
          tag: pair.tag.tagName,
          channel: pair.channel.channelName,
          user: pair.get('user.username'),
          applied: pair.applied
        });
      });
      return annotations;
    }
    return null;
  },
  setNumSelectedIntegrationsForCase(caseObj) {
    const integrations = caseObj.__state.integrations || [];
    let selectedCount = 0;

    integrations.forEach((integration) => {
      if (integration.selected) {
        selectedCount++;
      }
    });

    Ember.set(caseObj.__state, 'numSelectedWriteIntegrations', selectedCount);
  },
  setNumSelectedIntegrations(caseObj) {
    if (!caseObj || !caseObj.__state || !Array.isArray(caseObj.__state.integrations)) {
      return;
    }

    const integrations = caseObj.__state.integrations;
    const numSelected = integrations.filter((integration) => integration.selected).length;

    Ember.set(caseObj.__state, 'numSelectedWriteIntegrations', numSelected);
  },
  getNumSelectedIntegration(integrations) {
    let selectedCount = 0;
    if (integrations) {
      integrations.forEach((integration) => {
        if (integration.selected) {
          selectedCount++;
        }
      });
    }
    return selectedCount;
  },
  getScoreHuman(score) {
    if (score >= 801) {
      return 'critical';
    }
    if (score >= 501) {
      return 'high';
    }

    if (score >= 201) {
      return 'medium';
    }

    return 'low';
  },
  getRatingHuman(rating) {
    if (rating === 0) {
      return 'Unknown';
    }
    if (rating <= 1) {
      return 'Suspicious';
    }
    if (rating <= 2) {
      return 'Low';
    }
    if (rating <= 3) {
      return 'Moderate';
    }
    if (rating <= 4) {
      return 'High';
    }
    if (rating <= 5) {
      return 'Critical';
    }
    return 'Unknown';
  },
  getConfidenceHuman(confidence) {
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
  },
  async getField(indicatorId, field) {
    this.set(`indicators.${indicatorId}.__${field}Loading`, true);

    const payload = {
      action: 'GET_INDICATOR_FIELD',
      field,
      indicatorId
    };

    try {
      let result = await this.sendIntegrationMessage(payload);
      if (result.error) {
        console.error('Error', result);
        this.flashMessage(`${result.error.detail}`, 'danger');
      } else if (result.data && typeof result.data[field] !== 'undefined') {
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
              let fieldPageSize = this.get(`${field}PageSize`) || this.pageSize;
              const currentPage = this.get(`indicators.${indicatorId}.indicator.__${field}CurrentPage`);
              const totalItems = this.get(`indicators.${indicatorId}.indicator.${field}.data.length`);
              const totalPages = Math.ceil(totalItems / fieldPageSize);
              return currentPage === totalPages;
            })
          );

          Ember.defineProperty(
            this.get(`indicators.${indicatorId}.indicator`),
            `__${field}Filtered`,
            Ember.computed(`${field}.data.length`, `__${field}CurrentPage`, () => {
              let fieldPageSize = this.get(`${field}PageSize`) || this.pageSize;
              let totalItems = this.get(`indicators.${indicatorId}.indicator.${field}.data.length`);
              let currentPage = this.get(`indicators.${indicatorId}.indicator.__${field}CurrentPage`);
              const startIndex = (currentPage - 1) * fieldPageSize;
              const endIndex = startIndex + fieldPageSize > totalItems ? totalItems : startIndex + fieldPageSize;

              // Can't use set in a computed unless we ensure it only happens once per render
              Ember.run.scheduleOnce(
                'afterRender',
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
    } catch (err) {
      console.error('getField Error', err);
      if (err.status === '504') {
        this.set(`indicators.${indicatorId}.indicator.__${field}Timeout`, true);
      }
    } finally {
      this.set(`indicators.${indicatorId}.__${field}Loading`, false);
    }
  },
  setStartEndIndexes: function (indicatorId, field, startIndex, endIndex) {
    this.set(`indicators.${indicatorId}.indicator.__${field}StartItem`, startIndex);
    this.set(`indicators.${indicatorId}.indicator.__${field}EndItem`, endIndex);
  }
});
