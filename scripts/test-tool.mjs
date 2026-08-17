// PeeCare 本地測試工具 —— 網頁 UI + 後端代送 (proxy)
//
// local profile 保留 Emulator 工作流程；development-cloud profile 只允許固定的
// development health/event operations，且 ingestion secret 只存在於 Node process。

import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_PORT = 5055;
const LISTEN_HOST = '127.0.0.1';
const LOCAL_PROFILE = 'local';
const DEVELOPMENT_CLOUD_PROFILE = 'development-cloud';
const APPROVED_WEB_ORIGIN = 'https://petcare-c7483.web.app';
const APPROVED_INGESTION_ORIGIN =
  'https://peecare-ingestion-development-348528459946.asia-east1.run.app';
const APPROVED_MEMBER_ORIGIN =
  'https://peecare-member-development-348528459946.asia-east1.run.app';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const CLOUD_CONFIG_ERROR = 'Development-cloud test tool configuration is invalid.';
const CLOUD_OPERATION_ERROR = 'Cloud operation is not allowed.';
const CONFIG_SECRET_HOLDERS = new WeakMap();
const VALID_CONFIGS = new WeakSet();
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ASSET_PATHS = Object.freeze({
  'test-tool.html': resolve(SCRIPT_DIRECTORY, 'test-tool.html'),
  'machine.png': resolve(SCRIPT_DIRECTORY, 'machine.png'),
  'dog.png': resolve(SCRIPT_DIRECTORY, 'dog.png'),
});

function createPrivateSecretHolder(initialValue) {
  let value = initialValue;
  return Object.freeze({
    withSecret(consumer) {
      if (typeof value !== 'string' || typeof consumer !== 'function') {
        throw new Error(CLOUD_CONFIG_ERROR);
      }
      return consumer(value);
    },
    clear() {
      value = undefined;
    },
  });
}

function isSecretHolder(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.withSecret === 'function' &&
    typeof value.clear === 'function'
  );
}

export function createSourceAssetProvider({ readAsset = readFileSync } = {}) {
  if (typeof readAsset !== 'function') throw new Error('Invalid asset provider.');
  return Object.freeze({
    read(key) {
      const path = ASSET_PATHS[key];
      if (path === undefined) throw new Error('Invalid asset key.');
      return Buffer.from(readAsset(path));
    },
  });
}

export function createSeaAssetProvider({ getAsset } = {}) {
  if (typeof getAsset !== 'function') throw new Error('Invalid asset provider.');
  return Object.freeze({
    read(key) {
      if (!(key in ASSET_PATHS)) throw new Error('Invalid asset key.');
      return Buffer.from(getAsset(key));
    },
  });
}

export function createRuntimeAssetProvider({
  sea = false,
  getAsset,
  readAsset = readFileSync,
} = {}) {
  if (sea === true) return createSeaAssetProvider({ getAsset });
  if (sea === false) return createSourceAssetProvider({ readAsset });
  throw new Error('Invalid asset runtime.');
}

export async function loadRuntimeTestToolAssets({ sea = false, readAsset } = {}) {
  if (sea === false) {
    return loadTestToolAssets(createSourceAssetProvider({ readAsset }));
  }
  if (sea !== true) throw new Error('Invalid asset runtime.');
  const seaSpecifier = 'node:sea';
  const seaRuntime = await import(seaSpecifier);
  if (seaRuntime.isSea() !== true) throw new Error('Invalid asset runtime.');
  return loadTestToolAssets(
    createSeaAssetProvider({ getAsset: seaRuntime.getAsset }),
  );
}

export function loadTestToolAssets(provider = createRuntimeAssetProvider()) {
  if (provider === null || typeof provider?.read !== 'function') {
    throw new Error('Invalid asset provider.');
  }
  const htmlBytes = provider.read('test-tool.html');
  const machinePng = provider.read('machine.png');
  const dogPng = provider.read('dog.png');
  if (
    !Buffer.isBuffer(htmlBytes) ||
    !Buffer.isBuffer(machinePng) ||
    !Buffer.isBuffer(dogPng) ||
    htmlBytes.length === 0 ||
    machinePng.length === 0 ||
    dogPng.length === 0
  ) {
    throw new Error('Invalid embedded asset.');
  }
  let html;
  try {
    html = new TextDecoder('utf-8', { fatal: true }).decode(htmlBytes);
  } catch {
    throw new Error('Invalid embedded asset.');
  }
  if (html.length === 0) throw new Error('Invalid embedded asset.');
  return Object.freeze({
    html,
    machinePng: Buffer.from(machinePng),
    dogPng: Buffer.from(dogPng),
  });
}

function loadAssets() {
  return loadTestToolAssets(createSourceAssetProvider());
}

function isLoopback(target) {
  try {
    return LOOPBACK_HOSTS.has(new URL(target).hostname);
  } catch {
    return false;
  }
}

function exactApprovedOrigin(value, approvedOrigin) {
  if (value !== approvedOrigin) throw new Error(CLOUD_CONFIG_ERROR);
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      parsed.origin !== value
    ) {
      throw new Error(CLOUD_CONFIG_ERROR);
    }
    return parsed.origin;
  } catch {
    throw new Error(CLOUD_CONFIG_ERROR);
  }
}

function readOperatorSecret(path, readSecretFile, inspectSecretFile) {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new Error(CLOUD_CONFIG_ERROR);
  }
  try {
    const stats = inspectSecretFile(path);
    if (!stats.isFile() || (stats.mode & 0o077) !== 0) {
      throw new Error(CLOUD_CONFIG_ERROR);
    }
    const secret = readSecretFile(path, 'utf8').trim();
    if (
      secret === '' ||
      secret.length > 512 ||
      !/^[\u0021-\u007e]+$/u.test(secret)
    ) {
      throw new Error(CLOUD_CONFIG_ERROR);
    }
    return secret;
  } catch {
    throw new Error(CLOUD_CONFIG_ERROR);
  }
}

export function loadTestToolConfig(
  environment = process.env,
  { readSecretFile = readFileSync, inspectSecretFile = statSync } = {},
) {
  const profile = environment.PEECARE_TEST_TOOL_PROFILE ?? LOCAL_PROFILE;
  if (profile === LOCAL_PROFILE) {
    const config = Object.freeze({ profile });
    VALID_CONFIGS.add(config);
    return config;
  }
  if (profile !== DEVELOPMENT_CLOUD_PROFILE) {
    throw new Error('Test tool profile must be local or development-cloud.');
  }

  const origins = Object.freeze({
    web: exactApprovedOrigin(
      environment.PEECARE_DEVELOPMENT_WEB_ORIGIN,
      APPROVED_WEB_ORIGIN,
    ),
    ingestion: exactApprovedOrigin(
      environment.PEECARE_DEVELOPMENT_INGESTION_ORIGIN,
      APPROVED_INGESTION_ORIGIN,
    ),
    member: exactApprovedOrigin(
      environment.PEECARE_DEVELOPMENT_MEMBER_ORIGIN,
      APPROVED_MEMBER_ORIGIN,
    ),
  });
  const config = Object.freeze({ profile, origins });
  CONFIG_SECRET_HOLDERS.set(
    config,
    createPrivateSecretHolder(
      readOperatorSecret(
        environment.PEECARE_TEST_TOOL_INGESTION_SECRET_FILE,
        readSecretFile,
        inspectSecretFile,
      ),
    ),
  );
  VALID_CONFIGS.add(config);
  return config;
}

export function createOperatorTestToolConfig({ profile, secretHolder } = {}) {
  if (profile === LOCAL_PROFILE) {
    if (secretHolder !== undefined) throw new Error(CLOUD_CONFIG_ERROR);
    const config = Object.freeze({ profile });
    VALID_CONFIGS.add(config);
    return config;
  }
  if (profile !== DEVELOPMENT_CLOUD_PROFILE || !isSecretHolder(secretHolder)) {
    throw new Error(CLOUD_CONFIG_ERROR);
  }
  const config = Object.freeze({
    profile,
    origins: Object.freeze({
      web: APPROVED_WEB_ORIGIN,
      ingestion: APPROVED_INGESTION_ORIGIN,
      member: APPROVED_MEMBER_ORIGIN,
    }),
  });
  CONFIG_SECRET_HOLDERS.set(config, secretHolder);
  VALID_CONFIGS.add(config);
  return config;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      raw += chunk;
      if (raw.length > 1_000_000) {
        rejected = true;
        reject(new Error('request body too large'));
      }
    });
    req.on('end', () => {
      if (!rejected) resolve(raw);
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function hasCallerAuthorization(headers) {
  return (
    headers !== null &&
    typeof headers === 'object' &&
    Object.keys(headers).some((name) => name.toLowerCase() === 'authorization')
  );
}

function headerValue(headers, expectedName) {
  if (headers === null || typeof headers !== 'object') return undefined;
  const entry = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === expectedName.toLowerCase(),
  );
  return entry?.[1];
}

function isTrustedLoopbackPost(req) {
  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  try {
    if (!LOOPBACK_HOSTS.has(new URL(`http://${host}`).hostname)) return false;
  } catch {
    return false;
  }

  const contentType = req.headers['content-type'];
  if (
    typeof contentType !== 'string' ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)
  ) {
    return false;
  }

  const expectedOrigin = `http://${host}`;
  if (req.headers.origin !== undefined && req.headers.origin !== expectedOrigin) {
    return false;
  }
  const fetchSite = req.headers['sec-fetch-site'];
  return (
    fetchSite === undefined ||
    fetchSite === 'same-origin' ||
    fetchSite === 'none'
  );
}

function approvedCloudRequest(config, request) {
  if (
    request === null ||
    typeof request !== 'object' ||
    hasCallerAuthorization(request.headers)
  ) {
    return null;
  }
  const { method, url, headers, body } = request;
  if (method === 'GET' && body === undefined) {
    if (
      url === `${config.origins.ingestion}/health` ||
      url === `${config.origins.member}/health`
    ) {
      return { kind: 'health', method: 'GET', url, headers: {}, body: undefined };
    }
    return null;
  }
  if (
    method === 'POST' &&
    url === `${config.origins.ingestion}/v1/emqx/events` &&
    typeof body === 'string' &&
    headerValue(headers, 'content-type') === 'application/json'
  ) {
    const holder = CONFIG_SECRET_HOLDERS.get(config);
    if (!isSecretHolder(holder)) return null;
    try {
      return holder.withSecret((secret) => ({
        kind: 'event',
        method: 'POST',
        url,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`,
        },
        body,
      }));
    } catch {
      return null;
    }
  }
  return null;
}

function sanitizeCloudResponseBody(kind, text, requestBody) {
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return '{}';
    if (kind === 'health') {
      return parsed.status === 'ok' ? JSON.stringify({ status: 'ok' }) : '{}';
    }
    const safe = {};
    let expectedEventId;
    try {
      expectedEventId = JSON.parse(requestBody)?.payload?.eventId;
    } catch {}
    if (
      typeof parsed.eventId === 'string' &&
      parsed.eventId === expectedEventId &&
      /^[A-Za-z0-9._:-]{1,256}$/u.test(parsed.eventId)
    ) {
      safe.eventId = parsed.eventId;
    }
    if (
      typeof parsed.requestId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(parsed.requestId)
    ) {
      safe.requestId = parsed.requestId;
    }
    return JSON.stringify(safe);
  } catch {
    return '{}';
  }
}

async function proxyRequest(config, payload, fetchImpl) {
  let operation;
  if (config.profile === LOCAL_PROFILE) {
    if (typeof payload?.url !== 'string' || !isLoopback(payload.url)) {
      return {
        denied: true,
        error: '只允許送往 loopback 位址（127.0.0.1 / localhost）',
      };
    }
    operation = {
      kind: 'local',
      method: payload.method ?? 'GET',
      url: payload.url,
      headers: payload.headers ?? {},
      body: payload.body ?? undefined,
    };
  } else {
    operation = approvedCloudRequest(config, payload);
    if (operation === null) return { denied: true, error: CLOUD_OPERATION_ERROR };
  }

  const startedAt = Date.now();
  const upstream = await fetchImpl(operation.url, {
    method: operation.method,
    headers: operation.headers,
    body: operation.body,
    redirect: 'error',
  });
  const upstreamText = await upstream.text();
  const isCloud = config.profile === DEVELOPMENT_CLOUD_PROFILE;
  return {
    denied: false,
    response: {
      ok: true,
      status: upstream.status,
      statusText: isCloud ? '' : upstream.statusText,
      elapsedMs: Date.now() - startedAt,
      body: isCloud
        ? sanitizeCloudResponseBody(
            operation.kind,
            upstreamText,
            operation.body,
          )
        : upstreamText,
    },
  };
}

export function createTestToolServer({ config, fetchImpl = fetch, assets } = {}) {
  if (!VALID_CONFIGS.has(config)) {
    throw new Error('A validated test tool configuration is required.');
  }

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const resolvedAssets = assets ?? loadAssets();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(resolvedAssets.html);
      return;
    }

    if (req.method === 'GET' && (req.url === '/machine.png' || req.url === '/dog.png')) {
      const resolvedAssets = assets ?? loadAssets();
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
      res.end(req.url === '/machine.png' ? resolvedAssets.machinePng : resolvedAssets.dogPng);
      return;
    }

    if (req.method === 'GET' && req.url === '/api/config') {
      return sendJson(res, 200, {
        profile: config.profile,
        ...(config.profile === DEVELOPMENT_CLOUD_PROFILE
          ? { origins: config.origins }
          : {}),
      });
    }

    if (req.method === 'POST' && req.url === '/api/send') {
      if (!isTrustedLoopbackPost(req)) {
        return sendJson(res, 400, { ok: false, error: 'Request origin is not allowed.' });
      }
      try {
        const payload = JSON.parse((await readBody(req)) || '{}');
        const result = await proxyRequest(config, payload, fetchImpl);
        if (result.denied) {
          return sendJson(res, 400, { ok: false, error: result.error });
        }
        return sendJson(res, 200, result.response);
      } catch (error) {
        return sendJson(res, 200, {
          ok: false,
          error:
            config.profile === DEVELOPMENT_CLOUD_PROFILE
              ? 'Upstream request failed.'
              : error instanceof Error
                ? error.message
                : String(error),
        });
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });
  const secretHolder = CONFIG_SECRET_HOLDERS.get(config);
  if (isSecretHolder(secretHolder)) {
    server.once('close', () => secretHolder.clear());
  }
  return server;
}

export function startTestTool({ environment = process.env } = {}) {
  const config = loadTestToolConfig(environment);
  const port = environment.TOOL_PORT === undefined ? DEFAULT_PORT : Number(environment.TOOL_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('TOOL_PORT must be a valid TCP port.');
  }
  const server = createTestToolServer({ config });
  server.listen(port, LISTEN_HOST, () => {
    console.log(`PeeCare 本地測試工具已啟動：http://${LISTEN_HOST}:${port}`);
  });
  return server;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  try {
    startTestTool();
  } catch {
    console.error('PeeCare test tool startup failed: invalid configuration.');
    process.exitCode = 1;
  }
}
