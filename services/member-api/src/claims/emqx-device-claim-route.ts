import type {
  FastifyPluginAsync,
  FastifyReply,
} from 'fastify';

import type { ClaimService } from './claim-service.js';
import { PersistenceUnavailableError, type MemberApiErrorCode } from '../http/errors.js';
import {
  EmqxClaimAuthenticationError,
  type EmqxClaimAuthenticator,
} from '../security/emqx-claim-auth.js';

const ROUTE = '/v1/emqx/device-claims';
const BIND_TOPIC = 'peecare/device/1/bind';
const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const DEVICE_ID_PATTERN = /^[0-9A-F]{12}$/;
const PAIR_CODE_PATTERN = /^[0-9]{8}$/;
const LEGACY_IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const WRAPPER_KEYS = ['event', 'webhookAuthorization'] as const;
const EVENT_KEYS = [
  'brokerReceivedAtMs',
  'clientId',
  'payload',
  'qos',
  'retained',
  'topic',
  'username',
] as const;
const PAYLOAD_KEYS = ['device_id', 'pair_code'] as const;

interface CanonicalBindPayload {
  readonly device_id: string;
  readonly pair_code: string;
}

export interface CanonicalEmqxDeviceClaimEvent {
  readonly topic: typeof BIND_TOPIC;
  readonly clientId: string;
  readonly username: string;
  readonly qos: 0;
  readonly retained: false;
  readonly brokerReceivedAtMs: number;
  readonly payload: CanonicalBindPayload;
}

export interface EmqxDeviceClaimRouteDependencies {
  readonly claimService: Pick<ClaimService, 'applyBind'>;
  readonly authenticator: EmqxClaimAuthenticator;
  readonly sharedUsername: string;
}

export interface EmqxDeviceClaimRoutesOptions {
  readonly dependencies: EmqxDeviceClaimRouteDependencies;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpected.length &&
    actualKeys.every((key, index) => key === sortedExpected[index])
  );
}

function hasNoQuery(value: unknown): boolean {
  return isPlainRecord(value) && Object.keys(value).length === 0;
}

function parseCanonicalEvent(
  value: unknown,
  sharedUsername: string,
): CanonicalEmqxDeviceClaimEvent | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, EVENT_KEYS)) return null;
  if (!isPlainRecord(value.payload) || !hasExactKeys(value.payload, PAYLOAD_KEYS)) return null;

  const payload = value.payload;
  if (
    value.topic !== BIND_TOPIC ||
    value.qos !== 0 ||
    value.retained !== false ||
    value.username !== sharedUsername ||
    typeof value.clientId !== 'string' ||
    !LEGACY_IDENTITY_PATTERN.test(value.clientId) ||
    !Number.isSafeInteger(value.brokerReceivedAtMs) ||
    (value.brokerReceivedAtMs as number) < 0 ||
    typeof payload.device_id !== 'string' ||
    !DEVICE_ID_PATTERN.test(payload.device_id) ||
    typeof payload.pair_code !== 'string' ||
    !PAIR_CODE_PATTERN.test(payload.pair_code)
  ) {
    return null;
  }

  return value as unknown as CanonicalEmqxDeviceClaimEvent;
}

function sendCanonicalError(
  reply: FastifyReply,
  statusCode: number,
  code: MemberApiErrorCode,
  requestId: string,
) {
  return reply
    .header('x-request-id', requestId)
    .code(statusCode)
    .send({ error: { code, requestId } });
}

export const emqxDeviceClaimRoutes: FastifyPluginAsync<EmqxDeviceClaimRoutesOptions> = async (
  app,
  options,
) => {
  const { dependencies } = options;
  if (
    typeof dependencies.sharedUsername !== 'string' ||
    !LEGACY_IDENTITY_PATTERN.test(dependencies.sharedUsername)
  ) {
    throw new Error('EMQX Claim shared username must be a bounded legacy identity.');
  }

  app.route({
    method: ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    url: ROUTE,
    exposeHeadRoute: false,
    handler: async (request, reply) =>
      sendCanonicalError(reply, 405, 'method_not_allowed', request.id),
  });

  app.setErrorHandler((error, request, reply) => {
    const fastifyCode = (error as { code?: string }).code;
    if (fastifyCode === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return sendCanonicalError(reply, 415, 'unsupported_media_type', request.id);
    }
    if (fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return sendCanonicalError(reply, 413, 'body_too_large', request.id);
    }
    if (
      fastifyCode === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
      fastifyCode === 'FST_ERR_CTP_EMPTY_JSON_BODY'
    ) {
      return sendCanonicalError(reply, 400, 'malformed_json', request.id);
    }
    return sendCanonicalError(reply, 500, 'internal_error', request.id);
  });

  app.post<{ Querystring: Record<string, unknown> }>(ROUTE, async (request, reply) => {
    reply.header('x-request-id', request.id);

    const contentType = request.headers['content-type'];
    if (typeof contentType !== 'string' || !JSON_CONTENT_TYPE_PATTERN.test(contentType)) {
      return sendCanonicalError(reply, 415, 'unsupported_media_type', request.id);
    }

    if (request.headers.authorization !== undefined) {
      return sendCanonicalError(reply, 401, 'unauthorized', request.id);
    }

    const wrapper = isPlainRecord(request.body) ? request.body : null;
    try {
      dependencies.authenticator.assertBodyCredential(wrapper?.webhookAuthorization);
    } catch (error) {
      if (error instanceof EmqxClaimAuthenticationError) {
        return sendCanonicalError(reply, 401, 'unauthorized', request.id);
      }
      throw error;
    }

    if (
      !hasNoQuery(request.query) ||
      wrapper === null ||
      !hasExactKeys(wrapper, WRAPPER_KEYS)
    ) {
      return sendCanonicalError(reply, 400, 'invalid_request', request.id);
    }
    const event = parseCanonicalEvent(wrapper.event, dependencies.sharedUsername);
    if (event === null) {
      return sendCanonicalError(reply, 400, 'invalid_request', request.id);
    }

    try {
      await dependencies.claimService.applyBind({
        deviceId: event.payload.device_id,
        pairCode: event.payload.pair_code,
      });
      return reply.code(202).send({ status: 'accepted', requestId: request.id });
    } catch (error) {
      if (error instanceof PersistenceUnavailableError) {
        return sendCanonicalError(reply, 503, 'persistence_unavailable', request.id);
      }
      return sendCanonicalError(reply, 500, 'internal_error', request.id);
    }
  });
};
