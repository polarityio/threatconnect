module.exports = {
    /**
     * Name of the integration which is displayed in the Polarity integrations user interface
     *
     * @type String
     * @required
     */
    "name": "ThreatConnect",
    /**
     * The acronym that appears in the notification window when information from this integration
     * is displayed.  Note that the acronym is included as part of each "tag" in the summary information
     * for the integration.  As a result, it is best to keep it to 4 or less characters.  The casing used
     * here will be carried forward into the notification window.
     *
     * @type String
     * @required
     */
    "acronym":"TC",
    "logging": {level: 'info'},
    "entityTypes": ['IPv4', 'IPv6', 'hash', 'email'],
    "permissions": [
        "ALLOW_UNRESTRICTED_ENTITY_UPDATES"
    ],
    /**
     * Description for this integration which is displayed in the Polarity integrations user interface
     *
     * @type String
     * @optional
     */
    "description": "Polarity integration that connects to the ThreatConnect threat intelligence platform",
    /**
     * An array of style files (css or less) that will be included for your integration. Any styles specified in
     * the below files can be used in your custom template.
     *
     * @type Array
     * @optional
     */
    "styles":[
        "./styles/threatconnect.less"
    ],
    /**
     * Provide custom component logic and template for rendering the integration details block.  If you do not
     * provide a custom template and/or component then the integration will display data as a table of key value
     * pairs.
     *
     * @type Object
     * @optional
     */
    "block": {
        "component": {
            "file": "./components/threatconnect.js"
        },
        "template": {
            "file": "./templates/threatconnect.hbs"
        }
    },
    "integrationBlock": {
        "file": "./block/threatconnect.js"
    },
    /**
     * Options that are displayed to the user/admin in the Polarity integration user-interface.  Should be structured
     * as an array of option objects.
     *
     * @type Array
     * @optional
     */
    "options":[
        {
            "key": "url",
            "name": "ThreatConnect Instance URL",
            "description": "The URL of the ThreatConnect instance you would like to connect to (including http:// or https://)",
            "default": "",
            "type": "text",
            "userCanEdit": true,
            "adminOnly": false
        },
        {
            "key": "accessId",
            "name": "Access ID",
            "description": "Account Identifier that is associated with the API Key",
            "default": "",
            "type": "text",
            "userCanEdit": true,
            "adminOnly": false
        },
        {
            "key": "apiKey",
            "name": "API Key",
            "description": "The API Key associated with the provided Access ID",
            "default": "",
            "type": "text",
            "userCanEdit": true,
            "adminOnly": false
        },
        {
            "key": "defaultOrganizations",
            "name": "Default Organizations",
            "description": "A comma delimited list of organizations you would like to query.  " +
            "If left blank, will default to your ThreatConnect instance's default organization",
            "default": "",
            "type": "text",
            "userCanEdit": true,
            "adminOnly": false
        }
    ]
};