/**
 * Shared entity-expansion limits for every XMLParser in this codebase.
 *
 * fast-xml-parser 4.5.4+ caps XML entity expansion to mitigate billion-laughs style
 * attacks. Its default ceiling of 1000 total expansions is too low for real Sonos
 * data: indexing a 49,322-track music library needs roughly 4000 and fails with
 * "Entity expansion limit exceeded: 4002 > 1000", leaving the library index
 * incomplete. The ceiling is therefore raised and made configurable.
 *
 * Read from the environment rather than the config object because most XMLParser
 * instances here are constructed at module load, before loadConfiguration() runs.
 * This is the same early-initialisation exception the logger uses. The value is
 * also surfaced through the config loader so it appears in /debug/startup.
 */

import { XMLParser, type X2jOptions } from 'fast-xml-parser';

/**
 * Default ceiling on total entity expansions per parsed document.
 *
 * Chosen from measurement, not taste. Sonos returns DIDL-Lite entity-encoded inside
 * the SOAP <Result> element, so an entire nested XML document arrives as
 * "&lt;...&gt;&quot;..." text. Music library browse requests 1000 tracks at a time
 * (music-library-service.ts), which works out to roughly 8-10 expansions per track,
 * so a single response routinely exceeds 8000. Measured on a 48,140-track library:
 * 1000 failed at 4002, 8000 failed at 8004, and indexing completed once the ceiling
 * was lifted.
 *
 * 160000 is roughly 20x the observed failure boundary. The headroom is deliberate:
 * the per-document count scales with browse batch size and with how much punctuation
 * the track metadata carries, and the failure mode is a silently incomplete library
 * index rather than a loud crash. Overshooting costs nothing; undershooting costs a
 * broken search.
 *
 * The value stays finite deliberately: it is not the control that stops a
 * billion-laughs attack -- maxExpansionDepth and maxEntityCount are -- but an
 * unbounded counter removes a cheap backstop for nothing. Lower it via
 * XML_MAX_ENTITY_EXPANSIONS if you want a tighter bound.
 *
 * Note this counter resets per document (OrderedObjParser.parseXml), so it bounds a
 * single response, not the lifetime of a parser.
 */
export const DEFAULT_MAX_ENTITY_EXPANSIONS = 160000;

function readConfiguredLimit(): number {
  const raw = process.env.XML_MAX_ENTITY_EXPANSIONS;
  if (!raw) return DEFAULT_MAX_ENTITY_EXPANSIONS;

  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_ENTITY_EXPANSIONS;
  }
  return parsed;
}

/** Effective ceiling, from XML_MAX_ENTITY_EXPANSIONS or the default. */
export const maxEntityExpansions = readConfiguredLimit();

/**
 * processEntities options for XMLParser.
 *
 * Every limit is stated explicitly. Passing the object form makes fast-xml-parser
 * abandon the defaults it applies to the boolean form -- maxExpansionDepth would
 * silently become 10000 instead of 10, and maxTotalExpansions would become
 * Infinity -- so inheriting them would weaken protections we intend to keep.
 * Only the total-expansion ceiling is raised.
 *
 * Deliberately not exported: every parser must be built through createXmlParser
 * below, so the limits cannot be forgotten at a construction site.
 */
const processEntities = {
  enabled: true,
  maxEntitySize: 10000,
  maxExpansionDepth: 10,
  maxTotalExpansions: maxEntityExpansions,
  maxExpandedLength: 100000,
  maxEntityCount: 1000
};

/**
 * The only sanctioned way to construct an XMLParser in this codebase.
 *
 * Exists because the limits above were once wired by hand at eleven construction
 * sites, and the one site that missed them shipped a silent production failure
 * (services cache: "Entity expansion limit exceeded: 3256 > 1000", swallowed at
 * debug level). The factory injects processEntities unconditionally, and the
 * option type omits it so a caller cannot override or forget it.
 */
export function createXmlParser(options: Omit<X2jOptions, 'processEntities'> = {}): XMLParser {
  return new XMLParser({ ...options, processEntities });
}
