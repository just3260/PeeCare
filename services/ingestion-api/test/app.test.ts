import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { EventSink } from '../src/sinks/event-sink.js';

const payload = { schemaVersion: 1, eventId: 'PC-000001:42', eventType: 'urination', deviceId: 'PC-000001', sequence: 42, recordedAtMs: 1785168000000, firmwareVersion: '1.2.0', flushDurationMs: 3000, pumpDurationMs: 5000 };
const envelope = { topic: 'products/pc-mini/devices/PC-000001/events/urination', clientId: 'PC-000001', username: 'mqtt-user', qos: 1, retained: false, brokerReceivedAtMs: 1785168060000, payload };
const batteryEnvelope = { topic: 'products/pc-mini/devices/PC-000001/status/battery', clientId: 'PC-000001', username: 'mqtt-user', qos: 1, retained: false, brokerReceivedAtMs: 1785168060000, payload: { schemaVersion: 1, eventId: 'PC-000001:43', eventType: 'battery', deviceId: 'PC-000001', sequence: 43, recordedAtMs: 1785168000000, firmwareVersion: '1.2.0', batteryLevelPercent: 75, batteryVoltageMv: 3975 } };
const request = (body: unknown = envelope, authorization = 'Bearer current-secret') => ({ method: 'POST' as const, url: '/v1/emqx/events', headers: { authorization, 'content-type': 'application/json' }, payload: body });
const serverlessRequest = (body: unknown) => ({ method: 'POST' as const, url: '/v1/emqx/events', headers: { 'content-type': 'application/json' }, payload: body });

describe('ingestion application', () => {
  it('responds healthy without opening a port', async () => {
    const app = buildApp({ currentSecret: 'current-secret' });
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('exposes a Cloud Run compatible public health path', async () => {
    const app = buildApp({ currentSecret: 'current-secret' });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('exposes the broker root health surface without authentication', async () => {
    const app = buildApp({ currentSecret: 'current-secret' });
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toBeTruthy();
    await app.close();
  });

  it('accepts the Serverless connector empty JSON root POST as a health probe', async () => {
    let sinkCalls = 0;
    const app = buildApp({ currentSecret: 'current-secret', sink: { accept: async () => { sinkCalls++; return 'stored'; } } });
    const response = await app.inject({ method: 'POST', url: '/', headers: { 'content-type': 'application/json' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(sinkCalls).toBe(0);
    await app.close();
  });

  it.each([
    ['malformed JSON', { method: 'POST' as const, url: '/', headers: { 'content-type': 'application/json' }, payload: '{' }, 400, 'malformed_json'],
    ['an oversized body', { method: 'POST' as const, url: '/', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ value: 'x'.repeat(65_536) }) }, 413, 'body_too_large'],
    ['an empty webhook JSON body', { method: 'POST' as const, url: '/v1/emqx/events', headers: { authorization: 'Bearer current-secret', 'content-type': 'application/json' } }, 500, 'internal_error'],
  ])('does not broaden the root health fallback for %s', async (_case, input, status, code) => {
    let sinkCalls = 0;
    const app = buildApp({ currentSecret: 'current-secret', sink: { accept: async () => { sinkCalls++; return 'stored'; } } });
    const response = await app.inject(input);
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error: { code, requestId: response.headers['x-request-id'] } });
    expect(sinkCalls).toBe(0);
    await app.close();
  });

  it.each(['PUT', 'PATCH', 'DELETE', 'HEAD'] as const)('keeps %s / outside the broker health surface', async (method) => {
    const app = buildApp({ currentSecret: 'current-secret' });
    const response = await app.inject({ method, url: '/', headers: { 'content-type': 'application/json' } });
    expect(response.statusCode).toBe(404);
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.json()).toEqual({ error: { code: 'not_found', requestId: response.headers['x-request-id'] } });
    await app.close();
  });

  it.each(['Bearer current-secret', 'Bearer previous-secret'])('accepts either rotation secret', async (authorization) => {
    const sink: EventSink = { accept: async () => 'stored' };
    const app = buildApp({ currentSecret: 'current-secret', previousSecret: 'previous-secret', sink });
    expect((await app.inject(request(envelope, authorization))).statusCode).toBe(201);
    await app.close();
  });

  it.each(['Bearer current-secret', 'Bearer previous-secret'])('accepts either rotation secret through the Serverless body credential transport', async (webhookAuthorization) => {
    let calls = 0;
    const app = buildApp({ currentSecret: 'current-secret', previousSecret: 'previous-secret', sink: { accept: async () => { calls++; return 'stored'; } } });
    const response = await app.inject(serverlessRequest({ webhookAuthorization, event: envelope }));
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ eventId: payload.eventId, requestId: expect.any(String) });
    expect(calls).toBe(1);
    await app.close();
  });

  it.each([
    ['a missing credential', { event: envelope }, undefined],
    ['a wrong credential', { webhookAuthorization: 'Bearer wrong-secret', event: envelope }, undefined],
    ['a non-string credential', { webhookAuthorization: ['Bearer current-secret'], event: envelope }, undefined],
    ['an extra top-level field', { webhookAuthorization: 'Bearer current-secret', event: envelope, extra: true }, undefined],
    ['a non-object event', { webhookAuthorization: 'Bearer current-secret', event: [] }, undefined],
    ['simultaneous credential transports', { webhookAuthorization: 'Bearer current-secret', event: envelope }, 'Bearer current-secret'],
  ])('rejects %s with the same sanitized response and no sink side effect', async (_case, body, authorization) => {
    let calls = 0;
    const app = buildApp({ currentSecret: 'current-secret', sink: { accept: async () => { calls++; return 'stored'; } } });
    const response = await app.inject({
      ...serverlessRequest(body),
      headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: 'unauthorized', requestId: expect.any(String) } });
    expect(response.body).not.toContain('current-secret');
    expect(calls).toBe(0);
    await app.close();
  });

  it.each([undefined, 'Basic current-secret', 'Bearer wrong-secret', 'Bearer '])('returns the same 401 shape for invalid auth', async (authorization) => {
    let calls = 0;
    const app = buildApp({ currentSecret: 'current-secret', sink: { accept: async () => { calls++; return 'stored'; } } });
    const response = await app.inject({ ...request(), headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthorized');
    expect(calls).toBe(0);
    await app.close();
  });

  it.each([
    [{ ...envelope, retained: true }, 422, 'retained_event'],
    [{ ...envelope, qos: 3 }, 400, 'invalid_envelope'],
    [{ ...envelope, payload: 'not an object' }, 400, 'invalid_envelope'],
    [{ ...envelope, extra: true }, 400, 'invalid_envelope'],
    [{ ...envelope, clientId: 'other' }, 422, 'publisher_mismatch'],
  ])('rejects invalid envelopes before sink side effects', async (body, status, code) => {
    let calls = 0; const app = buildApp({ currentSecret: 'current-secret', sink: { accept: async () => { calls++; return 'stored'; } } });
    const response = await app.inject(request(body));
    expect(response.statusCode).toBe(status); expect(response.json().error.code).toBe(code); expect(calls).toBe(0);
    await app.close();
  });

  it('normalizes the event using injected server time and freezes it', async () => {
    let captured: unknown; const app = buildApp({ currentSecret: 'current-secret', now: () => 1785168060000, sink: { accept: async (event) => { captured = event; return 'stored'; } } });
    expect((await app.inject(request())).statusCode).toBe(201);
    expect(captured).toMatchObject({ receivedAtMs: 1785168060000, effectiveAtMs: 1785168000000, timeSource: 'device' });
    expect(Object.isFrozen(captured)).toBe(true); expect(Object.isFrozen((captured as { payload: object }).payload)).toBe(true);
    await app.close();
  });

  it.each([['accepted', 202], ['stored', 201], ['duplicate', 200]] as const)('maps sink %s', async (outcome, status) => {
    const app = buildApp({ currentSecret: 'current-secret', sink: { accept: async () => outcome } });
    expect((await app.inject(request())).statusCode).toBe(status); await app.close();
  });

  it.each([
    ['event_id_conflict', 409, 'event_id_conflict'],
    ['unknown_device', 422, 'unknown_device'],
    ['product_model_mismatch', 422, 'product_model_mismatch'],
    ['device_disabled', 403, 'device_disabled'],
    ['unavailable', 503, 'persistence_unavailable'],
    ['aggregation_integrity_error', 500, 'aggregation_integrity_error'],
  ] as const)('maps persistence outcome %s to a safe error', async (outcome, status, code) => {
    const app = buildApp({ currentSecret: 'current-secret', sink: { accept: async () => outcome } });
    const response = await app.inject(request());
    expect(response.statusCode).toBe(status); expect(response.json().error.code).toBe(code);
    await app.close();
  });

  it('returns only a sanitized code and request id for an aggregation integrity failure', async () => {
    const app = buildApp({ currentSecret: 'current-secret', sink: { accept: async () => 'aggregation_integrity_error' } });
    const response = await app.inject(request());
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'aggregation_integrity_error', requestId: expect.any(String) } });
    await app.close();
  });

  it.each([
    ['stored', 201, undefined], ['duplicate', 200, undefined], ['event_id_conflict', 409, 'event_id_conflict'],
    ['unknown_device', 422, 'unknown_device'], ['device_disabled', 403, 'device_disabled'], ['unavailable', 503, 'persistence_unavailable'],
  ] as const)('maps battery outcome %s to its stable, sanitized HTTP response', async (outcome, status, errorCode) => {
    const app = buildApp({ currentSecret: 'current-secret', sink: { accept: async () => outcome } });
    const response = await app.inject(request(batteryEnvelope));
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual(errorCode ? { error: { code: errorCode, requestId: expect.any(String) } } : { eventId: 'PC-000001:43', requestId: expect.any(String) });
    await app.close();
  });

  it.each([
    [{ method: 'GET', url: '/v1/emqx/events' }, 405, 'method_not_allowed'],
    [{ ...request(), headers: { authorization: 'Bearer current-secret', 'content-type': 'text/plain' } }, 415, 'unsupported_media_type'],
    [{ ...request(), payload: '{bad' }, 400, 'malformed_json'],
    [{ ...request('x'.repeat(65537)) }, 413, 'body_too_large'],
  ])('returns stable boundary errors with a request id', async (input, status, code) => {
    const app = buildApp({ currentSecret: 'current-secret' });
    const response = await app.inject(input as never);
    expect(response.statusCode).toBe(status); expect(response.json().error.code).toBe(code); expect(response.headers['x-request-id']).toBeTruthy();
    await app.close();
  });
});
