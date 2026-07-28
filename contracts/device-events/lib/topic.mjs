import { ERROR_CODES } from './error-codes.mjs';

// A single MQTT topic segment for productModel / deviceId.
// ASCII alphanumeric start, then alphanumeric / underscore / hyphen, 1..64 chars.
// No spaces, slashes, or MQTT wildcards (+ #) are permitted.
export const TOPIC_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// Canonical version 1 event topics. Fixed segments are literals; `null` marks a
// variable segment captured as productModel / deviceId.
const TOPIC_TEMPLATES = [
  {
    segments: ['products', null, 'devices', null, 'events', 'urination'],
    eventType: 'urination',
    schemaKey: 'urination',
  },
  {
    segments: ['products', null, 'devices', null, 'status', 'battery'],
    eventType: 'battery',
    schemaKey: 'battery',
  },
];

/**
 * Parse a device event topic against the version 1 canonical templates.
 *
 * @param {unknown} topic
 * @returns {{ productModel: string, deviceId: string, eventType: string, schemaKey: string }
 *          | { error: string }}
 *   On success the routed schema key and captured identity segments.
 *   On failure a stable error code: `topic_format` when a candidate template
 *   matches structurally but a variable segment is malformed, otherwise
 *   `unsupported_topic`.
 */
export function parseTopic(topic) {
  if (typeof topic !== 'string' || topic.length === 0) {
    return { error: ERROR_CODES.UNSUPPORTED_TOPIC };
  }

  const parts = topic.split('/');

  for (const template of TOPIC_TEMPLATES) {
    if (parts.length !== template.segments.length) continue;

    const structuralMatch = template.segments.every(
      (segment, index) => segment === null || segment === parts[index],
    );
    if (!structuralMatch) continue;

    const productModel = parts[1];
    const deviceId = parts[3];
    if (!TOPIC_SEGMENT_PATTERN.test(productModel) || !TOPIC_SEGMENT_PATTERN.test(deviceId)) {
      return { error: ERROR_CODES.TOPIC_FORMAT };
    }

    return {
      productModel,
      deviceId,
      eventType: template.eventType,
      schemaKey: template.schemaKey,
    };
  }

  // A slash inside productModel or deviceId creates extra MQTT segments. If
  // the canonical anchors and event suffix are still recognizable, classify
  // that candidate as a malformed canonical topic instead of an unsupported
  // topic.
  const hasCanonicalSuffix = TOPIC_TEMPLATES.some((template) => {
    const suffix = template.segments.slice(-2);
    return parts.slice(-2).every((part, index) => part === suffix[index]);
  });
  const devicesIndex = parts.lastIndexOf('devices', parts.length - 3);
  if (
    parts[0] === 'products' &&
    hasCanonicalSuffix &&
    devicesIndex > 1 &&
    devicesIndex < parts.length - 2
  ) {
    return { error: ERROR_CODES.TOPIC_FORMAT };
  }

  return { error: ERROR_CODES.UNSUPPORTED_TOPIC };
}
