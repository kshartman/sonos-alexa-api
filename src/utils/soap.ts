import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import logger from './logger.js';
import { debugManager } from './debug-manager.js';

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  format: false,
  suppressEmptyNode: true
});

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true
});

interface SoapEnvelope {
  's:Envelope': {
    '@_xmlns:s': string;
    '@_s:encodingStyle': string;
    's:Body': {
      [key: string]: {
        '@_xmlns:u': string;
        [key: string]: unknown;
      };
    };
  };
}

interface SoapFault {
  faultcode?: string;
  faultstring?: string;
  detail?: unknown;
}

interface SoapResponseBody {
  's:Fault'?: SoapFault;
  'SOAP-ENV:Fault'?: SoapFault;
  [key: string]: unknown;
}

interface SoapResponseEnvelope {
  's:Body'?: SoapResponseBody;
  'SOAP-ENV:Body'?: SoapResponseBody;
}

interface ParsedSoapResponse {
  's:Envelope'?: SoapResponseEnvelope;
  'SOAP-ENV:Envelope'?: SoapResponseEnvelope;
}

export function createSoapEnvelope(serviceType: string, action: string, body: Record<string, unknown> = {}): string {
  const envelope: SoapEnvelope = {
    's:Envelope': {
      '@_xmlns:s': 'http://schemas.xmlsoap.org/soap/envelope/',
      '@_s:encodingStyle': 'http://schemas.xmlsoap.org/soap/encoding/',
      's:Body': {
        [`u:${action}`]: {
          '@_xmlns:u': serviceType,
          ...body
        }
      }
    }
  };

  return xmlBuilder.build(envelope);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseSoapResponse(xml: string): any { // ANY IS CORRECT: SOAP responses have dynamic structure based on service/action
  try {
    const parsed = xmlParser.parse(xml) as ParsedSoapResponse;
    const envelope = parsed['s:Envelope'] || parsed['SOAP-ENV:Envelope'];
    if (!envelope) {
      throw new Error('Invalid SOAP response: no envelope found');
    }

    const body = envelope['s:Body'] || envelope['SOAP-ENV:Body'];
    if (!body) {
      throw new Error('Invalid SOAP response: no body found');
    }

    // Check for fault
    const fault = body['s:Fault'] || body['SOAP-ENV:Fault'];
    if (fault) {
      const error = new Error(fault.faultstring || 'SOAP fault') as Error & {
        code?: string;
        detail?: unknown;
      };
      error.code = fault.faultcode;
      error.detail = fault.detail;
      throw error;
    }

    // Return the first element in body (the response)
    const keys = Object.keys(body);
    if (keys.length === 0) {
      return {};
    }

    return body[keys[0]!];
  } catch (error) {
    logger.error('Error parsing SOAP response:', error);
    throw error;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function soapRequest(url: string, serviceType: string, action: string, body: Record<string, unknown> = {}): Promise<any> { // ANY IS CORRECT: Returns dynamic SOAP response data
  const soapAction = `"${serviceType}#${action}"`;
  const envelope = createSoapEnvelope(serviceType, action, body);

  debugManager.debug('soap', `SOAP Request to ${url}`, { action, body });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': soapAction
      },
      body: envelope
    });

    const responseText = await response.text();
    
    if (!response.ok) {
      logger.error(`SOAP request failed: ${response.status} ${response.statusText}`, { responseText });
      throw new Error(`SOAP request failed: ${response.status} ${response.statusText}`);
    }

    const result = parseSoapResponse(responseText);
    
    // Log detailed SOAP response at trace level (for massive XML responses)
    debugManager.trace('soap', `SOAP Response from ${url}`, { action, result });
    
    // Log summary at debug level
    debugManager.debug('soap', `SOAP Response from ${url} - ${action} completed`);
    
    return result;
  } catch (error) {
    logger.error(`SOAP request error for ${action}:`, error);
    throw error;
  }
}