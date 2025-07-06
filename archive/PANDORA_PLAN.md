# Pandora Station Switching Fix Plan

## Problem Summary
The current implementation has a SOAP 501 error when switching Pandora stations because it's missing critical elements from the SMAPI approach:
1. Missing proper metadata structure with `flags=8300` and correct `upnp:class`
2. Station ID format issues (using encoded station IDs instead of raw IDs in metadata)
3. Incorrect metadata structure in both pandora-service.ts and api-router.ts

## Root Cause Analysis

### Current Implementation vs SMAPI Documentation

1. **Missing SetAVTransportURI Step**
   - Our current implementation only calls `/pandora/play/{station}` endpoint
   - SMAPI documentation shows reliable station switching requires:
     - First calling `SetAVTransportURI` with proper metadata
     - Then calling `Play`

2. **Missing Critical Metadata**
   - SMAPI example includes:
     - `flags=8300` parameter in the URI (we have this)
     - Proper `upnp:class` set to `object.item.audioItem.audioBroadcast` (we use wrong class)
     - Station ID embedded in the URI correctly (we have this)
     - Complete DIDL-Lite metadata structure with raw station ID (we encode it incorrectly)

3. **Metadata Format Issues**
   - **Current upnp:class**: `object.container.playlistContainer` (api-router.ts) and `object.item.audioItem.audioBroadcast.#station` (pandora-service.ts)
   - **Should be**: `object.item.audioItem.audioBroadcast`
   - **Current item ID**: Uses encoded station ID in metadata
   - **Should be**: Raw station ID in metadata (encoding only in URI)

## Proposed Changes

### 1. Fix PandoraService.generateStationURI (pandora-service.ts)
- Keep the URI generation as-is (already includes flags=8300)
- The current format is correct: `x-sonosapi-radio:ST%3a{encodedId}?sid=236&flags=8300&sn=1`

### 2. Fix PandoraService.generateStationMetadata (pandora-service.ts)
- Change `upnp:class` from `object.item.audioItem.audioBroadcast.#station` to `object.item.audioItem.audioBroadcast`
- Fix the item ID format to use raw station ID (not encoded) in the metadata
- Update the metadata structure to match SMAPI example exactly

### 3. Fix api-router.ts pandoraPlay method metadata
- Update the metadata generation at line 2246 to use the corrected format
- Change `upnp:class` from `object.container.playlistContainer` to `object.item.audioItem.audioBroadcast`
- Ensure the metadata uses raw station ID extracted from the URI

### 4. Extract Station ID Properly
- When we have a URI like `x-sonosapi-radio:ST%3a4077371370208641611`, extract the raw ID `4077371370208641611`
- Use this raw ID in the metadata item ID field

## Specific Code Changes

### 1. pandora-service.ts - generateStationMetadata method
```typescript
static generateStationMetadata(stationId: string, stationName: string): string {
  // Do NOT encode the station ID for metadata - use raw ID
  const encodedName = stationName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  return `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"
    xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
    <item id="100c206cST:${stationId}" parentID="0" restricted="true">
      <dc:title>${encodedName}</dc:title>
      <upnp:class>object.item.audioItem.audioBroadcast</upnp:class>
      <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON${this.PANDORA_SERVICE_TYPE}_X_#Svc${this.PANDORA_SERVICE_TYPE}-0-Token</desc>
    </item>
  </DIDL-Lite>`;
}
```

### 2. api-router.ts - pandoraPlay method (around line 2246)
```typescript
// Extract raw station ID from URI if needed
let rawStationId = stationUri;
const stationMatch = stationUri.match(/ST%3a([^?]+)/);
if (stationMatch) {
  rawStationId = decodeURIComponent(stationMatch[1]);
}

// Generate metadata with proper service type for Pandora (SID 236)
const metadata = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"
  xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/"
  xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
  <item id="100c206cpndrradio-http://www.pandora.com/xml/images/icon_pandora.jpgST:${rawStationId}" parentID="pndrradio:" restricted="true">
    <dc:title>${stationTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</dc:title>
    <upnp:class>object.item.audioItem.audioBroadcast</upnp:class>
    <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">
      SA_RINCON236_
    </desc>
  </item>
</DIDL-Lite>`;
```

## Testing Plan
After making these changes:
1. Test playing a single Pandora station
2. Test switching between multiple stations without workarounds
3. Verify no SOAP 501 errors occur
4. Confirm smooth transitions without needing test song workarounds
5. Test with both API-based and browse-based station discovery

## Expected Outcome
- Station switching should work reliably without SOAP 501 errors
- No need for test song workarounds between station switches
- Cleaner, more reliable Pandora integration matching SMAPI specifications