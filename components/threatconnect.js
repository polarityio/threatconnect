'use strict';

polarity.export = PolarityComponent.extend({
    maxTagsToShow: 10,
    numAdditionalTags: Ember.computed('maxTagsToShow', 'block.data.details.tags.length', function(){
        let maxTagsToShow = this.get('maxTagsToShow');
        let totalTags = this.get('block.data.details.tags.length');
        let additionalTags = totalTags - maxTagsToShow;
        if(additionalTags > 0){
            return additionalTags;
        }
        return 0;
    })
});

