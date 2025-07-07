import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '_attr_',
  textNodeName: '_text',
  parseAttributeValue: false,
  trimValues: true
});

export function parseXML<T = unknown>(xml: string): T {
  return parser.parse(xml) as T;
}