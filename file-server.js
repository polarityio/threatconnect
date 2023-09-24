/*
 * Copyright (c) 2023, Polarity.io, Inc.
 */
const express = require('express');
const helmet = require('helmet');
const https = require('https');
const fs = require('fs');
const { port } = require('./config/file-server.json');
const { getLogger } = require('./logger');

function startFileServer(downloadTokenCache, threatConnect) {
  const Logger = getLogger();
  const app = express();

  app.use(helmet());
  app.disable('x-powered-by');

  app.get('/download/:downloadToken', function (req, res) {
    const downloadToken = req.params.downloadToken;
    if (downloadTokenCache.has(downloadToken)) {
      const { groupId, reportName } = downloadTokenCache.take(downloadToken);

      res.attachment(`${reportName}-Report.pdf`);
      Logger.trace({ downloadToken, groupId, res }, 'Sending Group Report');
      threatConnect.downloadGroupReport(groupId).pipe(res);
    } else {
      Logger.trace({downloadToken}, 'Missing Token');
      res.status(404).send('404 - Not Found');
    }
  });

  app.use((req, res, next) => {
    res.status(404).send('404 - Not Found');
  });

  const httpsServer = https.createServer(
    {
      key: fs.readFileSync('/home/ed/.ssl/key.pem'),
      cert: fs.readFileSync('/home/ed/.ssl/server.crt')
    },
    app
  );

  httpsServer.listen(port, () => {
    Logger.info(`Polarity-ThreatConnect File Server Listening on port ${port} over HTTPS`);
  });
}

module.exports = {
  startFileServer
};
