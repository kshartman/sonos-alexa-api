import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createSoapEnvelope, parseSoapResponse } from '../../src/utils/soap.js';

describe('SOAP Utilities', () => {
  describe('createSoapEnvelope', () => {
    it('should create valid SOAP envelope', () => {
      const xml = createSoapEnvelope(
        'urn:schemas-upnp-org:service:AVTransport:1',
        'Play',
        { InstanceID: 0, Speed: 1 }
      );
      
      assert(xml.includes('<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">'));
      assert(xml.includes('<InstanceID>0</InstanceID>'));
      assert(xml.includes('<Speed>1</Speed>'));
      assert(xml.includes('</s:Envelope>'));
    });

    it('should handle empty parameters', () => {
      const xml = createSoapEnvelope(
        'urn:schemas-upnp-org:service:AVTransport:1',
        'Stop',
        {}
      );
      
      assert(xml.includes('<u:Stop xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"/>') || 
             xml.includes('<u:Stop xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"></u:Stop>'));
    });

    it('should escape XML characters', () => {
      const xml = createSoapEnvelope(
        'urn:schemas-upnp-org:service:AVTransport:1',
        'SetAVTransportURI',
        { 
          CurrentURI: 'http://example.com?test=1&foo=bar',
          CurrentURIMetaData: '<DIDL-Lite>Test & Escape</DIDL-Lite>'
        }
      );
      
      assert(xml.includes('test=1&amp;foo=bar'));
      assert(xml.includes('&lt;DIDL-Lite&gt;Test &amp; Escape&lt;/DIDL-Lite&gt;'));
    });
  });

  describe('parseSoapResponse', () => {
    it('should parse simple response', () => {
      const xml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetVolumeResponse xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
              <CurrentVolume>50</CurrentVolume>
            </u:GetVolumeResponse>
          </s:Body>
        </s:Envelope>`;
      
      const result = parseSoapResponse(xml);
      assert.strictEqual(result.CurrentVolume, '50');
      assert(result['@_xmlns:u']);
    });

    it('should parse response with multiple values', () => {
      const xml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
              <CurrentTransportState>PLAYING</CurrentTransportState>
              <CurrentTransportStatus>OK</CurrentTransportStatus>
              <CurrentSpeed>1</CurrentSpeed>
            </u:GetTransportInfoResponse>
          </s:Body>
        </s:Envelope>`;
      
      const result = parseSoapResponse(xml);
      assert.strictEqual(result.CurrentTransportState, 'PLAYING');
      assert.strictEqual(result.CurrentTransportStatus, 'OK');
      assert.strictEqual(result.CurrentSpeed, '1');
      assert(result['@_xmlns:u']);
    });

    it('should handle empty response', () => {
      const xml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:PlayResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
            </u:PlayResponse>
          </s:Body>
        </s:Envelope>`;
      
      const result = parseSoapResponse(xml);
      assert(result['@_xmlns:u']);
      // Should have namespace attribute but no other keys
      const keys = Object.keys(result).filter(k => k !== '@_xmlns:u');
      assert.strictEqual(keys.length, 0);
    });

    it('should decode HTML entities', () => {
      const xml = `<?xml version="1.0"?>
        <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
              <TrackMetaData>&lt;DIDL-Lite&gt;Test &amp; Data&lt;/DIDL-Lite&gt;</TrackMetaData>
            </u:GetPositionInfoResponse>
          </s:Body>
        </s:Envelope>`;
      
      const result = parseSoapResponse(xml);
      assert.strictEqual(result.TrackMetaData, '<DIDL-Lite>Test & Data</DIDL-Lite>');
    });
  });
});