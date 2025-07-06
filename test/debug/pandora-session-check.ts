#!/usr/bin/env tsx
/**
 * Check Pandora session number from MusicServices
 */

import { XMLParser } from 'fast-xml-parser';

const DEVICE_IP = '192.168.11.47'; // OfficeSpeakers coordinator

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true
});

async function checkPandoraSession() {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
    <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <s:Body>
        <u:ListAvailableServices xmlns:u="urn:schemas-upnp-org:service:MusicServices:1">
        </u:ListAvailableServices>
      </s:Body>
    </s:Envelope>`;
  
  try {
    const response = await fetch(`http://${DEVICE_IP}:1400/MusicServices/Control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPACTION': '"urn:schemas-upnp-org:service:MusicServices:1#ListAvailableServices"'
      },
      body: soapBody
    });
    
    const text = await response.text();
    const data = xmlParser.parse(text);
    
    const services = data['s:Envelope']?.['s:Body']?.['u:ListAvailableServicesResponse']?.AvailableServiceDescriptorList;
    if (!services) {
      console.log('No services found');
      return;
    }
    
    // Decode the XML
    const decodedServices = services
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
    
    const servicesData = xmlParser.parse(decodedServices);
    const serviceList = servicesData.Services?.Service;
    if (!serviceList) {
      console.log('No services in list');
      return;
    }
    
    const serviceArray = Array.isArray(serviceList) ? serviceList : [serviceList];
    
    // Find Pandora
    const pandora = serviceArray.find(s => s['@_Name'] === 'Pandora' || s['@_Id'] === '236');
    if (pandora) {
      console.log('Pandora Service Details:');
      console.log(JSON.stringify(pandora, null, 2));
      
      // Check SessionIdList
      const sessionIdList = data['s:Envelope']?.['s:Body']?.['u:ListAvailableServicesResponse']?.AvailableServiceTypeList;
      if (sessionIdList) {
        console.log('\nSessionIdList (raw):', sessionIdList);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

// Also check account info
async function checkPandoraAccount() {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
    <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <s:Body>
        <u:GetSessionId xmlns:u="urn:schemas-upnp-org:service:MusicServices:1">
          <ServiceId>236</ServiceId>
          <Username>default</Username>
        </u:GetSessionId>
      </s:Body>
    </s:Envelope>`;
  
  try {
    const response = await fetch(`http://${DEVICE_IP}:1400/MusicServices/Control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPACTION': '"urn:schemas-upnp-org:service:MusicServices:1#GetSessionId"'
      },
      body: soapBody
    });
    
    const text = await response.text();
    console.log('\nGetSessionId Response:', text);
    
    const data = xmlParser.parse(text);
    const sessionId = data['s:Envelope']?.['s:Body']?.['u:GetSessionIdResponse']?.SessionId;
    if (sessionId) {
      console.log('\nPandora Session ID:', sessionId);
    }
  } catch (error) {
    console.error('GetSessionId Error:', error);
  }
}

async function main() {
  console.log('🔍 Checking Pandora Session Information\n');
  await checkPandoraSession();
  await checkPandoraAccount();
}

main().catch(console.error);