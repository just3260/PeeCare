import type { FastifyReply } from 'fastify';

export type ErrorCode = 'unauthorized' | 'not_found' | 'method_not_allowed' | 'body_too_large' | 'unsupported_media_type' | 'malformed_json' | 'invalid_envelope' | 'retained_event' | 'invalid_event' | 'publisher_mismatch' | 'sink_unavailable' | 'temporarily_unavailable' | 'event_id_conflict' | 'unknown_device' | 'product_model_mismatch' | 'device_disabled' | 'persistence_unavailable' | 'aggregation_integrity_error' | 'internal_error';

export function fail(reply: FastifyReply, statusCode: number, code: ErrorCode) {
  reply.header('x-request-id', reply.request.id);
  return reply.code(statusCode).send({ error: { code, requestId: reply.request.id } });
}
