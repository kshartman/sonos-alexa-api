import { test } from 'node:test';
import assert from 'node:assert';
import { createSoapEnvelope, parseSoapResponse } from './src/utils/soap.js';

test('SOAP envelope creation', () => {
  const envelope = createSoapEnvelope(
    'urn:schemas-upnp-org:service:AVTransport:1',
    'Play',
    { InstanceID: 0, Speed: 1 }
  );
  
  assert(envelope.includes('<s:Envelope'));
  assert(envelope.includes('xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"'));
  assert(envelope.includes('<u:Play'));
  assert(envelope.includes('<InstanceID>0</InstanceID>'));
  assert(envelope.includes('<Speed>1</Speed>'));
});

test('SOAP response parsing', () => {
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
});

test('API path matching', async () => {
  const { ApiRouter } = await import('./src/api-router.js');
  const router = new ApiRouter({ getDevice: () => null }, {});
  
  // Test exact match
  assert.deepStrictEqual(
    router.matchPath('/zones', '/zones'),
    {}
  );
  
  // Test parameterized path
  assert.deepStrictEqual(
    router.matchPath('/kitchen/play', '/{room}/play'),
    { room: 'kitchen' }
  );
  
  // Test volume with level
  assert.deepStrictEqual(
    router.matchPath('/living room/volume/50', '/{room}/volume/{level}'),
    { room: 'living room', level: '50' }
  );
  
  // Test non-matching path
  assert.strictEqual(
    router.matchPath('/foo/bar/baz', '/{room}/play'),
    null
  );
});

console.log('All tests passed!');