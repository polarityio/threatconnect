'use strict';
polarity.export = PolarityComponent.extend({
    classNames: ['threatconnect-details-block'],
    maxTagsToShow: 10,
    numAdditionalTags: Ember.computed('maxTagsToShow', 'block.data.tags.length', function(){
        let maxTagsToShow = this.get('maxTagsToShow');
        let totalTags = this.get('block.data.tags.length');
        let additionalTags = totalTags - maxTagsToShow;
        if(additionalTags > 0){
            return additionalTags;
        }
        return 0;
    })
});

