# Polarity ThreatConnect Integration

![image](https://img.shields.io/badge/status-beta-green.svg)

ThreatConnect is a security operations and analytics platform designed to allow teams to identify, manage, and block threats faster with intelligence.  For more information about ThreatConnect please visit:

https://threatconnect.com/

The Polarity ThreatConnect integration allows Polarity to search for address, file, host, and email indicators in ThreatConnect.

> Important: When installing this integration the installation directory cannot be called `threatconnect`.  See Installation Instructions for more info.


| ![image](https://user-images.githubusercontent.com/306319/50038372-acb97480-ffec-11e8-8505-df920f250447.png) |
|---|
|*Indicator Recognition*|

## Installation Instructions

When installing this integration please ensure the name of the directory within your `integrations` directory is not `threatconnect`.  This is to prevent a collision with the legacy client-side ThreatConnect integration.

As an example you could place this integration into the following directory on a default Polarity Server installation:

```bash
/app/polarity-server/integrations/threatconnect-v2
```

If cloning this repository using git please make sure to specify a custom directory name to clone into:

```bash
git clone https://github.com/polarityio/threatconnect.git threatconnect-v2
```

Installation instructions for integrations are provided on the [PolarityIO GitHub Page](https://polarityio.github.io/).

## Polarity

Polarity is a memory-augmentation platform that improves and accelerates analyst decision making.  For more information about the Polarity platform please see:

https://polarity.io/
