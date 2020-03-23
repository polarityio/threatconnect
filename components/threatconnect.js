'use strict';

polarity.export = PolarityComponent.extend({
  newTagValue: '',
  showFalsePositiveAlreadyReported: false,
  results: Ember.computed.alias('block.data.details.results'),
  timezone: Ember.computed('Intl', function() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }),
  _flashError: function(msg) {
    this.get('flashMessages').add({
      message: 'ThreatConnect: ' + msg,
      type: 'unv-danger',
      timeout: 3000
    });
  },
  actions: {
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
        .then(function(result) {
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
        .then(function(result) {
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
        .then(function(result) {
          if (result.error) {
            console.error(result.error);
            self._flashError(result.error.detail, 'error');
          } else {
            self.set('actionMessage', 'Deleted Tag');
            const newTags = [];
            let tags = self.get('results.' + orgDataIndex + '.tag');
            tags.forEach(function(tag, index) {
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
        .then(function(result) {
          if (result.error) {
            console.error(result.error);
            self._flashError(result.error.detail, 'error');
          } else {
            if (self.get('results.' + orgDataIndex + '.falsePositiveCount') === result.data.count) {
              self.set('showFalsePositiveAlreadyReported', true);
            } else {
              self.set('showFalsePositiveAlreadyReported', false);
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
        .then(function(result) {
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
    }
  }
});
