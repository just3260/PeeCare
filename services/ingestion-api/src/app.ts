import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { AppConfig, FirestoreConfig } from './config.js';
import { parseEnvelope } from './contracts/emqx-webhook-envelope.js';
import { validateWebhookEvent } from './contracts/validate-emqx-webhook-event.js';
import { fail } from './http/errors.js';
import { isAuthorized } from './security/webhook-auth.js';
import { SinkUnavailableError, TemporarySinkError, type EventSink } from './sinks/event-sink.js';
import { unconfiguredEventSink } from './sinks/unconfigured-event-sink.js';
import { createFirestore } from './firestore/firestore-client.js';
import { FirestoreEventSink } from './firestore/firestore-event-sink.js';

export function buildApp(options: Omit<AppConfig, 'firestore'> & { firestore?: FirestoreConfig; sink?: EventSink; now?: () => number; logger?: boolean }): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 65536, genReqId: () => randomUUID() });
  const sink = options.sink ?? (options.firestore ? new FirestoreEventSink(createFirestore(options.firestore)) : unconfiguredEventSink);
  const now = options.now ?? Date.now;
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/v1/emqx/events' && request.method !== 'POST') return fail(reply, 405, 'method_not_allowed');
  });
  const healthHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('x-request-id', request.id);
    return { status: 'ok' };
  };
  app.get('/healthz', healthHandler);
  app.get('/health', healthHandler);
  app.post('/v1/emqx/events', async (request, reply) => {
    reply.header('x-request-id', request.id);
    const contentType = request.headers['content-type'];
    if (typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) return fail(reply, 415, 'unsupported_media_type');
    if (!isAuthorized(request.headers.authorization, options.currentSecret, options.previousSecret)) return fail(reply, 401, 'unauthorized');
    const envelope = parseEnvelope(request.body);
    if (!envelope.ok) return fail(reply, envelope.code === 'retained_event' ? 422 : 400, envelope.code);
    const event = validateWebhookEvent(envelope.value, now());
    if (!event.ok) return fail(reply, 422, event.code);
    try {
      const outcome = await sink.accept(event.event, { requestId: request.id });
      if (outcome === 'event_id_conflict') return fail(reply, 409, 'event_id_conflict');
      if (outcome === 'unknown_device' || outcome === 'product_model_mismatch') return fail(reply, 422, outcome);
      if (outcome === 'device_disabled') return fail(reply, 403, outcome);
      if (outcome === 'unavailable') return fail(reply, 503, 'persistence_unavailable');
      if (outcome === 'aggregation_integrity_error') return fail(reply, 500, 'aggregation_integrity_error');
      const status = outcome === 'accepted' ? 202 : outcome === 'stored' ? 201 : 200;
      return reply.code(status).send({ eventId: event.event.payload.eventId, requestId: request.id });
    } catch (error) {
      if (error instanceof SinkUnavailableError) return fail(reply, 503, 'sink_unavailable');
      if (error instanceof TemporarySinkError) return fail(reply, 503, 'temporarily_unavailable');
      return fail(reply, 500, 'internal_error');
    }
  });
  app.setNotFoundHandler((request, reply) => fail(reply, 404, 'not_found'));
  app.setErrorHandler((error, request, reply) => {
    if ((error as { code?: string }).code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return fail(reply, 415, 'unsupported_media_type');
    if ((error as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') return fail(reply, 413, 'body_too_large');
    if ((error as { code?: string }).code === 'FST_ERR_CTP_INVALID_JSON_BODY') return fail(reply, 400, 'malformed_json');
    return fail(reply, 500, 'internal_error');
  });
  return app;
}
