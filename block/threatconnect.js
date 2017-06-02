'use strict';

polarity.export = IntegrationBlock.extend({
    /**
     * Override the base blockEquals method to test the organization information
     * @param otherBlock
     * @returns {boolean}
     */
    blockEquals: function(otherBlock){
        if(this.get('type') === otherBlock.get('type')){
            var ownerKey = 'data.details.owner.name';
            return this.get(ownerKey) === otherBlock.get(ownerKey);
        }
        return false;
    }
});


