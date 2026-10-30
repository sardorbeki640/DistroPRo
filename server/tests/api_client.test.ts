import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as any).window;
const originalLocalStorage = (globalThis as any).localStorage;

beforeEach(() => {
  (globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  (globalThis as any).window = {
    setTimeout: (callback: () => void) => globalThis.setTimeout(callback, 0),
    dispatchEvent: () => true
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as any).window = originalWindow;
  (globalThis as any).localStorage = originalLocalStorage;
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

test('API waits for database startup and retries the original request once', async () => {
  const { api } = await import('../../src/services/api.ts');
  let endpointCalls = 0;
  globalThis.fetch = async (input: any) => {
    if (String(input) === '/api/health') return json({ status: 'ok' });
    endpointCalls++;
    return endpointCalls === 1
      ? json({ success: false, error: 'Tizim bazadagi ma’lumotlarni yuklamoqda.' }, 503)
      : json({ success: true, settings: {} });
  };

  const result = await api.jarvis.settings();
  assert.deepEqual(result, { success: true, settings: {} });
  assert.equal(endpointCalls, 2);
});

test('API does not loop forever if a startup response persists after health turns ready', async () => {
  const { api } = await import('../../src/services/api.ts');
  let endpointCalls = 0;
  globalThis.fetch = async (input: any) => {
    if (String(input) === '/api/health') return json({ status: 'ok' });
    endpointCalls++;
    return json({ success: false, error: 'Tizim bazadagi ma’lumotlarni yuklamoqda.' }, 503);
  };

  await assert.rejects(() => api.jarvis.settings(), /Tizim bazadagi ma’lumotlarni yuklamoqda/);
  assert.equal(endpointCalls, 2, 'one original request and one retry only');
});

test('API retries a safe request after Render returns a non-JSON wake-up error', async () => {
  const { api } = await import('../../src/services/api.ts');
  let endpointCalls = 0;
  globalThis.fetch = async (input: any) => {
    if (String(input) === '/api/health') return json({ status: 'ok' });
    endpointCalls++;
    return endpointCalls === 1
      ? new Response('Service Unavailable', { status: 503, headers: { 'content-type': 'text/html' } })
      : json({ success: true, settings: {} });
  };

  const result = await api.jarvis.settings();
  assert.deepEqual(result, { success: true, settings: {} });
  assert.equal(endpointCalls, 2);
});
