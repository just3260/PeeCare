import { randomUUID } from 'node:crypto';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyServerOptions,
} from 'fastify';

import { APPROVED_WEB_ORIGIN } from './config.js';
import { TestDeviceNotFoundError } from './devices/test-device-repository.js';
import {
  InvalidTestEventRequestError,
  parseTestEventRequest,
  type TestEventRequest,
} from './events/test-event-request.js';
import {
  IngestionRejectedError,
  IngestionUnavailableError,
} from './ingestion/ingestion-client.js';
import {
  projectDeviceList,
  projectTestEventResult,
} from './http/response-contract.js';
import { FirebaseIdTokenAuthenticationError } from './security/firebase-id-token-verifier.js';
import { RateLimitedError, SequenceExhaustedError } from './usage/usage-ledger.js';

const DEVICE_LIST_PATH = '/v1/test-devices';
const EVENT_PATH = '/v1/test-devices/:deviceId/events';

export interface VerifiedTesterIdentity {
  readonly uid: string;
}

export interface TestToolTokenVerifier {
  verifyAuthorizationHeader(
    authorizationHeader: string | undefined,
  ): Promise<VerifiedTesterIdentity>;
}

export interface TestDeviceSummary {
  readonly deviceId: string;
  readonly displayName: string;
}

export interface TestEventSubmission {
  readonly memberUid: string;
  readonly deviceId: string;
  readonly body: TestEventRequest;
}

export interface TestToolRepository {
  listTestDevices(memberUid: string): Promise<readonly TestDeviceSummary[]>;
  submitTestEvent(submission: TestEventSubmission): Promise<unknown>;
}

export interface TestToolApiDependencies {
  readonly tokenVerifier: TestToolTokenVerifier;
  readonly repository: TestToolRepository;
}

export interface TestToolApiAppOptions {
  readonly dependencies: TestToolApiDependencies;
  readonly allowedOrigin: string;
  readonly enabled: boolean;
  readonly logger?: FastifyServerOptions['logger'];
  readonly logSink?: (entry: TestToolApiLogEntry) => void;
}

export interface TestToolApiLogEntry {
  readonly requestId: string;
  readonly statusCode: number;
  readonly outcome: 'request_complete';
}

type BaselineErrorCode =
  | 'forbidden_origin'
  | 'ingestion_unavailable'
  | 'invalid_request'
  | 'payload_too_large'
  | 'rate_limited'
  | 'sequence_exhausted'
  | 'test_device_not_found'
  | 'unsupported_media_type'
  | 'unauthorized'
  | 'internal_error'
  | 'not_found';

function sendCanonicalError(
  reply: FastifyReply,
  statusCode: number,
  code: BaselineErrorCode,
  requestId: string,
  retryAfterSeconds?: number,
) {
  return reply
    .header('x-request-id', requestId)
    .code(statusCode)
    .send({
      error: {
        code,
        requestId,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      },
    });
}

function hasApprovedJsonContentType(contentType: string | undefined): boolean {
  return /^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType ?? '');
}

export function buildApp(options: TestToolApiAppOptions): FastifyInstance {
  if (options.allowedOrigin !== APPROVED_WEB_ORIGIN) {
    throw new Error('The Test Tool API Web origin is not approved.');
  }

  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 8 * 1024,
    routerOptions: { maxParamLength: 256 },
    genReqId: () => randomUUID(),
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('vary', 'Origin');

    const origin = request.headers.origin;
    if (origin === options.allowedOrigin) {
      reply.header('access-control-allow-origin', options.allowedOrigin);
      return;
    }
    if (origin !== undefined && request.url.startsWith('/v1/')) {
      return sendCanonicalError(reply, 403, 'forbidden_origin', request.id);
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    const entry: TestToolApiLogEntry = {
      requestId: request.id,
      statusCode: reply.statusCode,
      outcome: 'request_complete',
    };
    if (options.logSink) {
      options.logSink(entry);
    } else {
      app.log.info(entry, 'test tool api request complete');
    }
  });

  app.get('/health', async () => ({ status: 'ok' as const }));

  async function verifyTester(
    authorizationHeader: string | undefined,
    reply: FastifyReply,
    requestId: string,
  ): Promise<VerifiedTesterIdentity | undefined> {
    try {
      return await options.dependencies.tokenVerifier.verifyAuthorizationHeader(
        authorizationHeader,
      );
    } catch (error) {
      if (error instanceof FirebaseIdTokenAuthenticationError) {
        sendCanonicalError(reply, 401, 'unauthorized', requestId);
        return undefined;
      }
      throw error;
    }
  }

  app.get(DEVICE_LIST_PATH, async (request, reply) => {
    const identity = await verifyTester(request.headers.authorization, reply, request.id);
    if (!identity) return reply;
    const devices = await options.dependencies.repository.listTestDevices(identity.uid);
    return reply.code(200).send({ devices: projectDeviceList(devices) });
  });

  app.post<{ Params: { deviceId: string }; Body: unknown }>(
    EVENT_PATH,
    async (request, reply) => {
      if (!hasApprovedJsonContentType(request.headers['content-type'])) {
        return sendCanonicalError(reply, 415, 'unsupported_media_type', request.id);
      }
      const identity = await verifyTester(request.headers.authorization, reply, request.id);
      if (!identity) return reply;
      if (!options.enabled) {
        return sendCanonicalError(reply, 503, 'ingestion_unavailable', request.id);
      }
      let body: TestEventRequest;
      try {
        body = parseTestEventRequest(request.body);
      } catch (error) {
        if (error instanceof InvalidTestEventRequestError) {
          return sendCanonicalError(reply, 400, 'invalid_request', request.id);
        }
        throw error;
      }
      const result = await options.dependencies.repository.submitTestEvent({
        memberUid: identity.uid,
        deviceId: request.params.deviceId,
        body,
      });
      return reply.code(200).send(
        projectTestEventResult(result, {
          deviceId: request.params.deviceId,
          eventType: body.eventType,
        }),
      );
    },
  );

  app.options(EVENT_PATH, async (request, reply) => {
    if (request.headers.origin === options.allowedOrigin) {
      reply.header('access-control-allow-methods', 'POST');
      reply.header('access-control-allow-headers', 'authorization, content-type');
    }
    return reply.code(204).send();
  });

  app.options(DEVICE_LIST_PATH, async (request, reply) => {
    if (request.headers.origin === options.allowedOrigin) {
      reply.header('access-control-allow-methods', 'GET');
      reply.header('access-control-allow-headers', 'authorization');
    }
    return reply.code(204).send();
  });

  app.setNotFoundHandler((request, reply) =>
    sendCanonicalError(reply, 404, 'not_found', request.id),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof IngestionUnavailableError) {
      return sendCanonicalError(reply, 503, 'ingestion_unavailable', request.id);
    }
    if (error instanceof IngestionRejectedError) {
      return sendCanonicalError(reply, 404, 'test_device_not_found', request.id);
    }
    if (error instanceof RateLimitedError) {
      return sendCanonicalError(
        reply,
        429,
        'rate_limited',
        request.id,
        error.retryAfterSeconds,
      );
    }
    if (error instanceof SequenceExhaustedError) {
      return sendCanonicalError(reply, 409, 'sequence_exhausted', request.id);
    }
    if (error instanceof TestDeviceNotFoundError) {
      return sendCanonicalError(reply, 404, 'test_device_not_found', request.id);
    }
    if ((error as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return sendCanonicalError(reply, 413, 'payload_too_large', request.id);
    }
    if ((error as { code?: string }).code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return sendCanonicalError(reply, 415, 'unsupported_media_type', request.id);
    }
    if ((error as { code?: string }).code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return sendCanonicalError(reply, 400, 'invalid_request', request.id);
    }
    return sendCanonicalError(reply, 500, 'internal_error', request.id);
  });

  return app;
}
