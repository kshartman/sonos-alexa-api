// sonos-dump-all.js
const COORDINATOR_IP = process.env.COORDINATOR_IP;
const fetch = global.fetch;

const endpoints = [
  "/status",
  "/status/accounts",
  "/status/zp",
  "/xml/services",
  "/status/avtransport",
  "/status/zoneplayers",
  "/status/systeminfo",
  "/status/diagnostics",
];

function hr(s) {
  console.log("\n" + "-".repeat(60));
  if (s) console.log(s);
}

async function getAndPrint(url, label) {
  try {
    hr(label);
    const res = await fetch(`http://${COORDINATOR_IP}:1400${url}`);
    const text = await res.text();
    console.log(`GET ${url}:\n`, text);
  } catch (e) {
    console.log(`Error fetching ${url}:`, e && e.message || e);
  }
}

// AVTransport action template
async function avTransportAction(action, xml) {
  try {
    hr(`AVTransport: ${action}`);
    const res = await fetch(`http://${COORDINATOR_IP}:1400/MediaRenderer/AVTransport/Control`, {
      method: "POST",
      headers: {
        SOAPACTION: `"urn:schemas-upnp-org:service:AVTransport:1#${action}"`,
        "Content-Type": "text/xml; charset=utf-8",
      },
      body: xml,
    });
    const text = await res.text();
    console.log(`AVTransport#${action}:\n`, text);
  } catch (e) {
    console.log(`Error with AVTransport#${action}:`, e && e.message || e);
  }
}

// ContentDirectory browse
async function upnpBrowse(objectId) {
  try {
    hr(`ContentDirectory: Browse "${objectId}"`);
    const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <ObjectID>${objectId}</ObjectID>
      <BrowseFlag>BrowseDirectChildren</BrowseFlag>
      <Filter>*</Filter>
      <StartingIndex>0</StartingIndex>
      <RequestedCount>100</RequestedCount>
      <SortCriteria></SortCriteria>
    </u:Browse>
  </s:Body>
</s:Envelope>`;
    const res = await fetch(`http://${COORDINATOR_IP}:1400/MediaServer/ContentDirectory/Control`, {
      method: "POST",
      headers: {
        SOAPACTION: `"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"`,
        "Content-Type": "text/xml; charset=utf-8",
      },
      body,
    });
    const text = await res.text();
    console.log(`Browse "${objectId}":\n`, text);
  } catch (e) {
    console.log(`Error browsing ${objectId}:`, e && e.message || e);
  }
}

(async () => {
  // 1. Status endpoints
  for (const url of endpoints) {
    await getAndPrint(url, `GET ${url}`);
  }

  // 2. Common ContentDirectory roots
  const roots = [
    "0",          // Root
    "FV:2",       // My Sonos
    "Q:0",        // Queue
    "R:0/0",      // Music services root
    "A:STATIONS", // All stations
    "A:ALBUMS",   // All albums
    "S:1",        // Service 1, etc
  ];
  for (const root of roots) {
    await upnpBrowse(root);
  }

  // 3. Brute-force music services
  for (let i = 1; i <= 300; i++) {
    await upnpBrowse("S:" + i);
  }

  // 4. Brute-force R: and Q: containers (less common, sometimes used for cloud music services)
  for (let i = 0; i <= 5; i++) {
    await upnpBrowse("R:0/" + i);
    await upnpBrowse("Q:" + i);
  }

  // 5. AVTransport: GetPositionInfo & GetMediaInfo
  const posInfoXml = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetPositionInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
    </u:GetPositionInfo>
  </s:Body>
</s:Envelope>`;
  await avTransportAction("GetPositionInfo", posInfoXml);

  const mediaInfoXml = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetMediaInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
    </u:GetMediaInfo>
  </s:Body>
</s:Envelope>`;
  await avTransportAction("GetMediaInfo", mediaInfoXml);

  hr("ALL DONE");
})();
