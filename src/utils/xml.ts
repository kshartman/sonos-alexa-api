import { createXmlParser } from './xml-entity-limits.js';

const parser = createXmlParser({
  ignoreAttributes: false,
  attributeNamePrefix: '_attr_',
  textNodeName: '_text',
  parseAttributeValue: false,
  trimValues: true
});

export function parseXML<T = unknown>(xml: string): T {
  return parser.parse(xml) as T;
}