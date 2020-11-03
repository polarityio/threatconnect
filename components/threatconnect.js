'use strict';

polarity.export = PolarityComponent.extend({
  newTagValue: '',
  showFalsePositiveAlreadyReported: false,
  details: Ember.computed.alias('block.data.details'),
  summary: Ember.computed.alias('block.data.summary'),
  results: Ember.computed.alias('details.results'),
  timezone: Ember.computed('Intl', function () {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }),
  playbooks: Ember.computed.alias('details.playbooks'),
  indicatorType: Ember.computed.alias('details.indicatorType'),
  entityValue: Ember.computed.alias('block.entity.value'),
  onDemand: Ember.computed('block.entity.requestContext.requestType', function () {
    return this.block.entity.requestContext.requestType === 'OnDemand';
  }),
  indicatorMessage: '',
  indicatorErrorMessage: '',
  indicatorPlaybookId: null,
  isRunning: false,
  _flashError: function (msg) {
    this.get('flashMessages').add({
      message: 'ThreatConnect: ' + msg,
      type: 'unv-danger',
      timeout: 3000
    });
  },
  actions: {
    changeTab: function (tabName, orgDataIndex) {
      this.set(`results.${orgDataIndex}.__activeTab`, tabName);
    },
    saveConfidence(orgData, orgDataIndex) {
      console.info('Saving Confidence');
      let self = this;

      self.set('block.isLoadingDetails', true);
      const payload = {
        action: 'SET_CONFIDENCE',
        data: {
          indicatorValue: orgData.meta.indicatorValue,
          indicatorType: orgData.meta.indicatorType,
          owner: orgData.owner.name,
          confidence: orgData.__shadowConfidence
        }
      };

      this.sendIntegrationMessage(payload)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            self._flashError(result.error.detail, 'error');

            let originalValue = self.get('results.' + orgDataIndex + '.confidence');
            // Note: this is a trick to get the property observers to fire so we can reset the
            // slider value.  We have to change the value to trigger observers
            self.set('results.' + orgDataIndex + '.confidence', originalValue + 1);
            self.set('results.' + orgDataIndex + '.confidence', originalValue);
          } else {
            self.set('results.' + orgDataIndex + '.confidence', result.data.confidence);
            self.set('results.' + orgDataIndex + '.confidenceHuman', result.data.confidenceHuman);
          }
        })
        .finally(() => {
          self.set('block.isLoadingDetails', false);
        });
    },
    addTag(orgData, orgDataIndex) {
      let self = this;

      const newTag = this.get('newTagValue').trim();
      if (newTag.length === 0) {
        this.set('actionMessage', 'You must enter a tag');
        return;
      }

      self.set('block.isLoadingDetails', true);
      self.set('results.' + orgDataIndex + '.__addingTag', true);
      const payload = {
        action: 'ADD_TAG',
        data: {
          indicatorValue: orgData.meta.indicatorValue,
          indicatorType: orgData.meta.indicatorType,
          owner: orgData.owner.name,
          tag: newTag
        }
      };

      this.sendIntegrationMessage(payload)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            self._flashError(result.error.detail, 'error');
          } else {
            self.set('actionMessage', 'Added Tag');
            self.get('results.' + orgDataIndex + '.tag').pushObject({
              name: newTag,
              webLink: result.data.link
            });
          }
        })
        .finally(() => {
          self.set('newTagValue', '');
          self.set('block.isLoadingDetails', false);
          self.set('results.' + orgDataIndex + '.__addingTag', false);
        });
    },
    deleteTag(tag, orgData, orgDataIndex, tagIndex) {
      let self = this;

      self.set('block.isLoadingDetails', true);
      self.set('results.' + orgDataIndex + '.__deletingTag', true);

      const payload = {
        action: 'DELETE_TAG',
        data: {
          indicatorValue: orgData.meta.indicatorValue,
          indicatorType: orgData.meta.indicatorType,
          owner: orgData.owner.name,
          tag: tag
        }
      };

      this.sendIntegrationMessage(payload)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            self._flashError(result.error.detail, 'error');
          } else {
            self.set('actionMessage', 'Deleted Tag');
            const newTags = [];
            let tags = self.get('results.' + orgDataIndex + '.tag');
            tags.forEach(function (tag, index) {
              if (index !== tagIndex) {
                newTags.push(tag);
              }
            });

            self.set('results.' + orgDataIndex + '.tag', newTags);
          }
        })
        .finally(() => {
          self.set('block.isLoadingDetails', false);
          self.set('results.' + orgDataIndex + '.__deletingTag', false);
        });
    },
    reportFalsePositive(orgData, orgDataIndex) {
      let self = this;

      self.set('block.isLoadingDetails', true);
      const payload = {
        action: 'REPORT_FALSE_POSITIVE',
        data: {
          indicatorValue: orgData.meta.indicatorValue,
          indicatorType: orgData.meta.indicatorType,
          owner: orgData.owner.name
        }
      };

      this.sendIntegrationMessage(payload)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            self._flashError(result.error.detail, 'error');
          } else {
            if (self.get('results.' + orgDataIndex + '.falsePositiveCount') === result.data.count) {
              self.set('results.' + orgDataIndex + '.__showFalsePositiveAlreadyReported', true);
            } else {
              self.set('results.' + orgDataIndex + '.__showFalsePositiveAlreadyReported', false);
            }
            self.set('results.' + orgDataIndex + '.falsePositiveLastReported', result.data.lastReported);
            self.set('results.' + orgDataIndex + '.falsePositiveCount', result.data.count);
          }
        })
        .finally(() => {
          self.set('block.isLoadingDetails', false);
        });
    },
    setRating(orgData, orgDataIndex, rating) {
      let self = this;

      self.set('block.isLoadingDetails', true);
      const payload = {
        action: 'SET_RATING',
        data: {
          indicatorValue: orgData.meta.indicatorValue,
          indicatorType: orgData.meta.indicatorType,
          owner: orgData.owner.name,
          rating: rating
        }
      };

      this.sendIntegrationMessage(payload)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            self._flashError(result.error.detail, 'error');
          } else {
            self.set('actionMessage', 'Set rating to : ' + rating);
            self.set('results.' + orgDataIndex + '.rating', rating);
            self.set('results.' + orgDataIndex + '.ratingHuman', result.data.ratingHuman);
          }
        })
        .finally(() => {
          self.set('block.isLoadingDetails', false);
        });
    },
    createIndicator: function () {
      const outerThis = this;
      this.set('indicatorMessage', '');
      this.set('isRunning', true);
      this.get('block').notifyPropertyChange('data');

      this.sendIntegrationMessage({
        action: 'CREATE_INDICATOR',
        data: {
          entity: this.block.entity,
        }
      })
        .then(({ error, details, summary }) => {
          // if (error) {
          //   return outerThis.set(
          //     'indicatorErrorMessage',
          //     `Failed: ${err.detail || err.message || err.title || err.description || 'Unknown Reason'}`
          //   );
          // }
          if (details) outerThis.set('details', details);
          if (summary) outerThis.set('summary', summary);

          outerThis.set('indicatorMessage', 'Indicator Added Successfully!');
        })
        .catch((err) => {
          outerThis.set(
            'indicatorErrorMessage',
            `Failed: ${err.detail || err.message || err.title || err.description || 'Unknown Reason'}`
          );
        })
        .finally(() => {
          outerThis.set('isRunning', false);
          outerThis.get('block').notifyPropertyChange('data');
          setTimeout(() => {
            outerThis.set('indicatorErrorMessage','');
            outerThis.set('indicatorMessage', '');
            outerThis.get('block').notifyPropertyChange('data');
          }, 5000);
        });
    }
  }
});
