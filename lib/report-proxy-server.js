/*
 * Copyright (c) 2023, Polarity.io, Inc.
 */
const express = require('express');
const helmet = require('helmet');
const https = require('https');
const http = require('http');
const fs = require('fs');
const { getLogger } = require('./logger');
const reportProxyServerConfig = require('../config/report-proxy-server.json');

function startReportProxyServer(downloadTokenCache, threatConnect) {
  const Logger = getLogger();
  const app = express();

  app.use(helmet());
  app.disable('x-powered-by');

  app.get('/download/:downloadToken', function (req, res) {
    const downloadToken = req.params.downloadToken;
    if (downloadTokenCache.has(downloadToken)) {
      const { groupId, reportName } = downloadTokenCache.get(downloadToken);

      res.attachment(`${reportName}-Report.pdf`);
      Logger.trace({ downloadToken, groupId, reportName }, 'Sending Group Report');
      threatConnect.downloadGroupReport(groupId).pipe(res);
    } else {
      Logger.trace({ downloadToken }, 'Invalid or Missing Download Token');
      res.status(404).send('404 - Not Found');
    }
  });

  app.use((req, res, next) => {
    res.status(404).send('404 - Not Found');
  });

  let server;

  if (reportProxyServerConfig.sslEnabled) {
    server = https.createServer(
      {
        key: fs.readFileSync(reportProxyServerConfig.sslPrivateKey),
        cert: fs.readFileSync(reportProxyServerConfig.sslCert)
      },
      app
    );
  } else {
    server = http.createServer(app);
  }

  server.listen(reportProxyServerConfig.port, () => {
    Logger.info(
      `Polarity-ThreatConnect Report Proxy Server Listening on port ${reportProxyServerConfig.port} over ${
        reportProxyServerConfig.sslEnabled ? 'HTTPS' : 'HTTP'
      }`
    );
  });
}

module.exports = {
  startReportProxyServer
};
