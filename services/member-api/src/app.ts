import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyServerOptions,
} from 'fastify';
import { randomUUID } from 'node:crypto';
import { emqxDeviceClaimRoutes } from './claims/emqx-device-claim-route.js';
import type { ClaimService } from './claims/claim-service.js';
import { parseAllowedWebOrigin } from './config.js';
import { InvalidCustomNameError } from './devices/custom-name.js';
import { DeviceNotFoundError } from './firestore/device-name-repository.js';
import {
  PersistenceUnavailableError,
  type MemberApiErrorCode,
} from './http/errors.js';
import { MemberAuthenticationError } from './security/firebase-id-token-verifier.js';
import type { EmqxClaimAuthenticator } from './security/emqx-claim-auth.js';

const DISPLAY_NAME_PATH = '/v1/devices/:deviceId/display-name';
const CLAIM_SESSION_COLLECTION_PATH = '/v1/device-claim-sessions';
const CLAIM_SESSION_STATUS_PATH = '/v1/device-claim-sessions/:sessionId';
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CLAIM_DEVICE_ID_PATTERN = /^[0-9A-F]{12}$/;
const CLAIM_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

export interface VerifiedMember {
  readonly uid: string;
}

export interface MemberTokenVerifier {
  verifyAuthorizationHeader(authorizationHeader: string | undefined): Promise<VerifiedMember>;
}

export interface UpdateDisplayNameCommand {
  readonly memberUid: string;
  readonly deviceId: string;
  readonly customName: string | null;
}

export interface DeviceDisplayName {
  readonly deviceId: string;
  readonly customName: string | null;
  readonly displayName: string;
}

export interface DeviceNameService {
  updateDisplayName(command: UpdateDisplayNameCommand): Promise<DeviceDisplayName>;
}

export type MemberClaimService = Pick<
  ClaimService,
  'createSession' | 'getSessionStatus' | 'applyBind'
>;

export interface MemberApiDependencies {
  readonly tokenVerifier: MemberTokenVerifier;
  readonly deviceNameService: DeviceNameService;
  readonly claimService?: MemberClaimService;
  readonly emqxClaimAuthenticator?: EmqxClaimAuthenticator;
  readonly emqxClaimSharedUsername?: string;
}

export interface MemberApiAppOptions {
  readonly dependencies: MemberApiDependencies;
  readonly allowedOrigin: string;
  readonly logger?: FastifyServerOptions['logger'];
  readonly logSink?: (entry: MemberApiLogEntry) => void;
}

export interface MemberApiLogEntry {
  readonly requestId: string;
  readonly routeClass: MemberApiRouteClass;
  readonly statusCode: number;
  readonly outcome: 'request_complete';
}

export type MemberApiRouteClass =
  | 'health'
  | 'device_name'
  | 'member_claim'
  | 'emqx_claim'
  | 'unmatched';

function isExactCustomNameBody(body: unknown): body is { readonly customName: string | null } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return false;
  }
  const record = body as Record<string, unknown>;
  return (
    Object.keys(record).length === 1 &&
    Object.prototype.hasOwnProperty.call(record, 'customName') &&
    (typeof record.customName === 'string' || record.customName === null)
  );
}

function isExactClaimSessionBody(body: unknown): body is { readonly deviceId: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return false;
  }
  const record = body as Record<string, unknown>;
  return (
    Object.keys(record).length === 1 &&
    Object.prototype.hasOwnProperty.call(record, 'deviceId') &&
    typeof record.deviceId === 'string' &&
    CLAIM_DEVICE_ID_PATTERN.test(record.deviceId)
  );
}

function hasNoQuery(query: unknown): boolean {
  return (
    typeof query === 'object' &&
    query !== null &&
    !Array.isArray(query) &&
    Object.keys(query as Record<string, unknown>).length === 0
  );
}

function classifyRoute(routeUrl: string | undefined): MemberApiRouteClass {
  switch (routeUrl) {
    case '/health':
    case '/healthz':
      return 'health';
    case DISPLAY_NAME_PATH:
      return 'device_name';
    case CLAIM_SESSION_COLLECTION_PATH:
    case CLAIM_SESSION_STATUS_PATH:
      return 'member_claim';
    case '/v1/emqx/device-claims':
      return 'emqx_claim';
    default:
      return 'unmatched';
  }
}

function sendCanonicalError(
  reply: FastifyReply,
  status: number,
  code: MemberApiErrorCode,
  requestId: string,
) {
  return reply
    .header('x-request-id', requestId)
    .code(status)
    .send({ error: { code, requestId } });
}

export function buildApp(options: MemberApiAppOptions): FastifyInstance {
  const allowedOrigin = parseAllowedWebOrigin(options.allowedOrigin);
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 8 * 1024,
    routerOptions: { maxParamLength: 256 },
    genReqId: () => randomUUID(),
    frameworkErrors(error, request, reply) {
      const frameworkCode = (error as { code?: string }).code;
      if (frameworkCode === 'FST_ERR_MAX_PARAM_LENGTH' || frameworkCode === 'FST_ERR_BAD_URL') {
        const code = request.url.startsWith(CLAIM_SESSION_COLLECTION_PATH)
          ? 'invalid_request'
          : 'invalid_device_id';
        return sendCanonicalError(reply, 400, code, request.id);
      }
      return sendCanonicalError(reply, 500, 'internal_error', request.id);
    },
  });

  function fail(
    reply: Parameters<Parameters<typeof app.setErrorHandler>[0]>[2],
    status: number,
    code: MemberApiErrorCode,
    requestId: string,
  ) {
    return sendCanonicalError(reply, status, code, requestId);
  }

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('vary', 'Origin');
    if (request.headers.origin === allowedOrigin) {
      reply.header('access-control-allow-origin', allowedOrigin);
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    const entry: MemberApiLogEntry = {
      requestId: request.id,
      routeClass: classifyRoute(request.routeOptions.url),
      statusCode: reply.statusCode,
      outcome: 'request_complete',
    };
    if (options.logSink) {
      options.logSink(entry);
    } else {
      app.log.info(entry, 'member api request complete');
    }
  });

  const healthResponse = async () => ({ status: 'ok' as const });
  app.get('/health', healthResponse);
  app.get('/healthz', healthResponse);

  app.patch<{
    Params: { deviceId: string };
    Body: { customName: string | null };
  }>(DISPLAY_NAME_PATH, async (request, reply) => {
    if (!DEVICE_ID_PATTERN.test(request.params.deviceId)) {
      return fail(reply, 400, 'invalid_device_id', request.id);
    }

    const contentType = request.headers['content-type'];
    if (typeof contentType !== 'string' || !JSON_CONTENT_TYPE_PATTERN.test(contentType)) {
      return fail(reply, 415, 'unsupported_media_type', request.id);
    }

    if (!isExactCustomNameBody(request.body)) {
      return fail(reply, 400, 'invalid_request', request.id);
    }

    let member: VerifiedMember;
    try {
      member = await options.dependencies.tokenVerifier.verifyAuthorizationHeader(
        request.headers.authorization,
      );
    } catch (error) {
      if (error instanceof MemberAuthenticationError) {
        return fail(reply, 401, 'unauthorized', request.id);
      }
      throw error;
    }

    try {
      const result = await options.dependencies.deviceNameService.updateDisplayName({
        memberUid: member.uid,
        deviceId: request.params.deviceId,
        customName: request.body.customName,
      });
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof InvalidCustomNameError) {
        return fail(reply, 400, 'invalid_custom_name', request.id);
      }
      if (error instanceof DeviceNotFoundError) {
        return fail(reply, 404, 'device_not_found', request.id);
      }
      if (error instanceof PersistenceUnavailableError) {
        return fail(reply, 503, 'persistence_unavailable', request.id);
      }
      return fail(reply, 500, 'internal_error', request.id);
    }
  });

  const claimService = options.dependencies.claimService;
  if (claimService !== undefined) {
    app.post<{
      Body: { deviceId: string };
      Querystring: Record<string, unknown>;
    }>(CLAIM_SESSION_COLLECTION_PATH, async (request, reply) => {
      const contentType = request.headers['content-type'];
      if (typeof contentType !== 'string' || !JSON_CONTENT_TYPE_PATTERN.test(contentType)) {
        return fail(reply, 415, 'unsupported_media_type', request.id);
      }
      if (!hasNoQuery(request.query) || !isExactClaimSessionBody(request.body)) {
        return fail(reply, 400, 'invalid_request', request.id);
      }

      let member: VerifiedMember;
      try {
        member = await options.dependencies.tokenVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
        );
      } catch (error) {
        if (error instanceof MemberAuthenticationError) {
          return fail(reply, 401, 'unauthorized', request.id);
        }
        throw error;
      }

      try {
        const result = await claimService.createSession({
          memberUid: member.uid,
          deviceId: request.body.deviceId,
        });
        if (!result.ok) {
          switch (result.reason) {
            case 'claim_in_progress':
              return fail(reply, 409, 'claim_in_progress', request.id);
            case 'already_owned':
              return fail(reply, 409, 'already_owned', request.id);
            case 'device_unavailable':
              return fail(reply, 404, 'device_not_found', request.id);
          }
        }

        const { sessionId, deviceId, pairCode, status, expiresAtMs } = result.session;
        return reply.code(201).send({ sessionId, deviceId, pairCode, status, expiresAtMs });
      } catch (error) {
        if (error instanceof PersistenceUnavailableError) {
          return fail(reply, 503, 'persistence_unavailable', request.id);
        }
        return fail(reply, 500, 'internal_error', request.id);
      }
    });

    app.get<{
      Params: { sessionId: string };
      Querystring: Record<string, unknown>;
    }>(CLAIM_SESSION_STATUS_PATH, { exposeHeadRoute: false }, async (request, reply) => {
      if (
        !hasNoQuery(request.query) ||
        !CLAIM_SESSION_ID_PATTERN.test(request.params.sessionId)
      ) {
        return fail(reply, 400, 'invalid_request', request.id);
      }

      let member: VerifiedMember;
      try {
        member = await options.dependencies.tokenVerifier.verifyAuthorizationHeader(
          request.headers.authorization,
        );
      } catch (error) {
        if (error instanceof MemberAuthenticationError) {
          return fail(reply, 401, 'unauthorized', request.id);
        }
        throw error;
      }

      try {
        const status = await claimService.getSessionStatus({
          memberUid: member.uid,
          sessionId: request.params.sessionId,
        });
        if (status === null) {
          return fail(reply, 404, 'not_found', request.id);
        }
        return reply.code(200).send({
          sessionId: status.sessionId,
          deviceId: status.deviceId,
          status: status.status,
          expiresAtMs: status.expiresAtMs,
        });
      } catch (error) {
        if (error instanceof PersistenceUnavailableError) {
          return fail(reply, 503, 'persistence_unavailable', request.id);
        }
        return fail(reply, 500, 'internal_error', request.id);
      }
    });

    app.route({
      method: ['GET', 'PUT', 'PATCH', 'DELETE'],
      url: CLAIM_SESSION_COLLECTION_PATH,
      handler: async (request, reply) => fail(reply, 405, 'method_not_allowed', request.id),
    });

    app.route({
      method: ['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
      url: CLAIM_SESSION_STATUS_PATH,
      handler: async (request, reply) => fail(reply, 405, 'method_not_allowed', request.id),
    });

    app.options(CLAIM_SESSION_COLLECTION_PATH, async (request, reply) => {
      if (!hasNoQuery(request.query)) {
        return fail(reply, 400, 'invalid_request', request.id);
      }
      if (request.headers.origin === allowedOrigin) {
        reply.header('access-control-allow-methods', 'POST');
        reply.header('access-control-allow-headers', 'authorization, content-type');
      }
      return reply.code(204).send();
    });

    app.options<{ Params: { sessionId: string }; Querystring: Record<string, unknown> }>(
      CLAIM_SESSION_STATUS_PATH,
      async (request, reply) => {
        if (
          !hasNoQuery(request.query) ||
          !CLAIM_SESSION_ID_PATTERN.test(request.params.sessionId)
        ) {
          return fail(reply, 400, 'invalid_request', request.id);
        }
        if (request.headers.origin === allowedOrigin) {
          reply.header('access-control-allow-methods', 'GET');
          reply.header('access-control-allow-headers', 'authorization');
        }
        return reply.code(204).send();
      },
    );
  }

  const emqxClaimAuthenticator = options.dependencies.emqxClaimAuthenticator;
  const emqxClaimSharedUsername = options.dependencies.emqxClaimSharedUsername;
  if ((emqxClaimAuthenticator === undefined) !== (emqxClaimSharedUsername === undefined)) {
    throw new Error('EMQX Claim route dependencies must be configured together.');
  }
  if (emqxClaimAuthenticator !== undefined && emqxClaimSharedUsername !== undefined) {
    if (claimService === undefined) {
      throw new Error('EMQX Claim route requires the shared Claim service.');
    }
    app.register(emqxDeviceClaimRoutes, {
      dependencies: {
        claimService,
        authenticator: emqxClaimAuthenticator,
        sharedUsername: emqxClaimSharedUsername,
      },
    });
  }

  app.route({
    method: ['GET', 'POST', 'PUT', 'DELETE'],
    url: DISPLAY_NAME_PATH,
    handler: async (request, reply) => fail(reply, 405, 'method_not_allowed', request.id),
  });

  app.options<{ Params: { deviceId: string } }>(DISPLAY_NAME_PATH, async (request, reply) => {
    if (!DEVICE_ID_PATTERN.test(request.params.deviceId)) {
      return fail(reply, 400, 'invalid_device_id', request.id);
    }
    if (request.headers.origin === allowedOrigin) {
      reply.header('access-control-allow-methods', 'PATCH');
      reply.header('access-control-allow-headers', 'authorization, content-type');
    }
    return reply.code(204).send();
  });

  app.setNotFoundHandler((request, reply) => {
    const displayNameMatch = request.url.match(/^\/v1\/devices\/(.*)\/display-name(?:\?.*)?$/);
    if (displayNameMatch && !DEVICE_ID_PATTERN.test(decodeURIComponent(displayNameMatch[1]))) {
      return fail(reply, 400, 'invalid_device_id', request.id);
    }
    return fail(reply, 404, 'not_found', request.id);
  });

  app.setErrorHandler((error, request, reply) => {
    const fastifyCode = (error as { code?: string }).code;
    if (fastifyCode === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return fail(reply, 415, 'unsupported_media_type', request.id);
    }
    if (fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return fail(reply, 413, 'body_too_large', request.id);
    }
    if (
      fastifyCode === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
      fastifyCode === 'FST_ERR_CTP_EMPTY_JSON_BODY'
    ) {
      return fail(reply, 400, 'malformed_json', request.id);
    }
    return fail(reply, 500, 'internal_error', request.id);
  });

  return app;
}
