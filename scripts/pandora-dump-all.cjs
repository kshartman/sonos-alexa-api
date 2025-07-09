// browse-fv2-pandora.cjs (improved, no URI column)
const COORDINATOR_IP = process.env.SONOS_IP || "127.0.0.1";
const http = require("http");

function decodeXmlEntities(str) {
    return str
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&#x2F;/g, "/")
        .replace(/&apos;/g, "'");
}

function extractField(str, key) {
    const m = str.match(new RegExp(`[?&]${key}=([^&]+)`, 'i'));
    return m ? decodeURIComponent(m[1]) : "";
}
function extractStationId(uri) {
    // Handle different formats:
    // x-sonosapi-radio:ST%3a4115366826458437828?sid=236&flags=8300&sn=3
    // x-sonosapi-radio:ST:2415902933774981316?sid=236&flags=8300&sn=3
    // x-sonosapi-radio:SF%3a16722%3a297243?sid=236&flags=8300&sn=3
    const m = uri.match(/x-sonosapi-radio:([^?]+)/i);
    if (!m) return "";
    
    let stationPart = m[1];
    // Decode if it contains encoded characters
    if (stationPart.includes('%')) {
        stationPart = decodeURIComponent(stationPart);
    }
    
    // Extract just the ID part after ST: or SF:
    const idMatch = stationPart.match(/^(?:ST:|SF:)(.+)$/i);
    return idMatch ? idMatch[1] : stationPart;
}
function pad(s, n) {
    return String(s || '').padEnd(n, ' ');
}

function upnpBrowseFV2(callback) {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <ObjectID>FV:2</ObjectID>
      <BrowseFlag>BrowseDirectChildren</BrowseFlag>
      <Filter>*</Filter>
      <StartingIndex>0</StartingIndex>
      <RequestedCount>100</RequestedCount>
      <SortCriteria></SortCriteria>
    </u:Browse>
  </s:Body>
</s:Envelope>`;

    const options = {
        hostname: COORDINATOR_IP,
        port: 1400,
        path: "/MediaServer/ContentDirectory/Control",
        method: "POST",
        headers: {
            SOAPACTION: '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"',
            "Content-Type": "text/xml; charset=utf-8",
            "Content-Length": Buffer.byteLength(body)
        }
    };

    const req = http.request(options, res => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
            const resultMatch = data.match(/<Result>([\s\S]*?)<\/Result>/i);
            if (!resultMatch) {
                console.log("No <Result> field found in FV:2 browse.");
                process.exit(1);
            }
            const decodedXml = decodeXmlEntities(resultMatch[1]);
            callback(decodedXml);
        });
    });

    req.on("error", e => {
        console.error("HTTP error:", e);
        process.exit(1);
    });
    req.write(body);
    req.end();
}

function parsePandoraItems(xml) {
    const items = xml.split(/<item /i).slice(1).map(str => "<item " + str.split(/<\/item>/i)[0] + "</item>");
    const pandoraFavorites = [];
    for (const item of items) {
        // Look for Pandora stations (sid=236)
        const resMatch = item.match(/<res[^>]*>([^<]*)<\/res>/i);
        if (resMatch && resMatch[1].includes('sid=236')) {
            // The URI might have &amp; instead of & due to XML encoding
            const uri = resMatch[1].replace(/&amp;/g, '&').replace(/\s+/g, '');
            
            // Extract parameters
            const sn = extractField(uri, "sn");
            const flags = extractField(uri, "flags");
            const sid = extractField(uri, "sid");
            const stationId = extractStationId(uri);
            
            // Extract title
            const titleMatch = item.match(/<dc:title>([^<]+)<\/dc:title>/i);
            const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : "";
            
            // Extract description
            const descMatch = item.match(/<r:description>([^<]*)<\/r:description>/i);
            const description = descMatch ? decodeXmlEntities(descMatch[1]) : "";
            
            // Also check for station type prefix
            const stationType = uri.match(/x-sonosapi-radio:(ST|SF)/i);
            const typePrefix = stationType ? stationType[1] : "ST";
            
            pandoraFavorites.push({
                title,
                sn,
                sid,
                flags,
                stationId,
                stationType: typePrefix,
                description,
            });
        }
    }
    return pandoraFavorites;
}

upnpBrowseFV2(xml => {
    const pandoraFavorites = parsePandoraItems(xml);

    if (pandoraFavorites.length === 0) {
        console.log("No Pandora favorites found in FV:2.");
        process.exit(0);
    }

    // Display columns with station type
    const cols = [
        { k: "title", h: "Station Name", w: 36 },
        { k: "sn", h: "SN", w: 4 },
        { k: "sid", h: "SID", w: 5 },
        { k: "flags", h: "Flags", w: 8 },
        { k: "stationType", h: "Type", w: 4 },
        { k: "stationId", h: "Station ID", w: 28 },
        { k: "description", h: "Description", w: 30 }
    ];

    console.log(
        cols.map(c => pad(c.h, c.w)).join(" | ")
    );
    console.log(
        cols.map(c => "-".repeat(c.w)).join("-|-")
    );

    // Sort by session number (sn) then by title
    pandoraFavorites.sort((a, b) => {
        if (a.sn !== b.sn) {
            return parseInt(a.sn || '0') - parseInt(b.sn || '0');
        }
        return a.title.localeCompare(b.title);
    });
    
    pandoraFavorites.forEach(row => {
        console.log(
            cols.map(c => pad(row[c.k], c.w)).join(" | ")
        );
    });
    
    // Add summary by session number
    console.log("\n" + "=".repeat(128));
    console.log("Summary by Session Number:");
    console.log("=".repeat(128));
    
    const bySn = {};
    pandoraFavorites.forEach(fav => {
        const sn = fav.sn || 'unknown';
        if (!bySn[sn]) bySn[sn] = [];
        bySn[sn].push(fav.title);
    });
    
    Object.keys(bySn).sort((a, b) => parseInt(a) - parseInt(b)).forEach(sn => {
        console.log(`SN ${sn}: ${bySn[sn].length} stations - ${bySn[sn].join(', ')}`);
    });
});
