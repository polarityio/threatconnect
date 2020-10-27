const GET_PLAYBOOKS = {
  results: [
    {
      id: 17843,
      groupXid: 'tAalQAvW',
      name: 'Archive.org Wayback Machine Query',
      description:
        "Query for a Host or URL Indicator in Archive.org's Wayback Machine (https://archive.org/web/web.php).",
      webLink: 'https://sandbox.threatconnect.com/auth/playbooks/playbook.xhtml?id=17843',
      groupWebLink: 'https://sandbox.threatconnect.com/auth/playbooks/playbook.xhtml?xid=tAalQAvW',
      version: '1.0',
      comment: null,
      type: 'Playbook',
      triggerType: 'UserAction',
      endpoint: null,
      active: false,
      basicAuthEnabled: false,
      logLevel: 'WARN',
      updated: 1603147750280,
      labels: [],
      priority: 6
    }
  ],
  offset: 0,
  total: 1
};

const PLAYBOOK_TRIGGERS = {
  17843: {
    status: 'Success',
    data: {
      id: 18625,
      name: 'Query Web Archive for Indicator',
      type: 'UserAction',
      eventType: 'External',
      locationLeft: -90.0,
      locationTop: 150.0,
      httpResponseHeader: '[]',
      httpResponseBody: '#App:163770:message!String',
      anyOrg: true,
      userActionTypes: 'Host,URL',
      overrideRunAsUser: true,
      renderBodyAsTip: true,
      playbookTriggerFilterList: [],
      outputVariables: '[{"sourceInputList":[],"loopVariables":false,"name":"trg.action.item","type":"String"}]',
      cacheMinutes: 120,
      cacheParams: '{"includeMethod":false,"includeBody":false,"queryParams":[],"headerNames":[]}'
    }
  },

};
module.exports = {
  GET_PLAYBOOKS,
  PLAYBOOK_TRIGGERS
};