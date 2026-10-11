import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { integrationProvider } from '../integrations/provider.ts';
import { SalesDocAdapter } from '../integrations/adapters/salesdoc.adapter.ts';

describe('Integration Adapters Pattern', () => {
  test('Registered adapters exist', () => {
    const adapters = integrationProvider.listAdapters();
    assert.ok(adapters.length >= 3);
    assert.ok(adapters.some(a => a.name === 'SALESDOC'));
    assert.ok(adapters.some(a => a.name === '1C_ENTERPRISE_ERP'));
    assert.ok(adapters.some(a => a.name === 'EXCEL_ADAPTER'));
    assert.ok(adapters.some(a => a.name === 'MANUAL_OPERATOR_ADAPTER'));
  });

  test('SalesDocAdapter normalizes API endpoint to /api/v2 correctly', () => {
    const adapter = new SalesDocAdapter();
    assert.equal(
      adapter.normalizeEndpoint('https://server.salesdoctor.uz'),
      'https://server.salesdoctor.uz/api/v2'
    );
    assert.equal(
      adapter.normalizeEndpoint('https://server.salesdoctor.uz/api/v2'),
      'https://server.salesdoctor.uz/api/v2'
    );
    assert.equal(
      adapter.normalizeEndpoint('http://app.salesdoctor.uz/v2'),
      'http://app.salesdoctor.uz/api/v2'
    );
    assert.equal(
      adapter.normalizeEndpoint('https://app.salesdoctor.uz/api'),
      'https://app.salesdoctor.uz/api/v2'
    );
  });

  test('SalesDocAdapter rejects incomplete imports when offline', async () => {
    const adapter = new SalesDocAdapter();
    const dummyConfig = { server_url: 'http://127.0.0.1:59999/api/v2', api_token: 'test_token' };

    await assert.rejects(()=>adapter.importProducts(dummyConfig));

    await assert.rejects(()=>adapter.importCustomers(dummyConfig));

    await assert.rejects(()=>adapter.importOrders(dummyConfig));

    // An unreachable server must be an error, never "0 payments".
    await assert.rejects(()=>adapter.importPayments(dummyConfig));
  });

  test('SalesDocAdapter validates credentials in testConnection', async () => {
    const adapter = new SalesDocAdapter();
    const resNoToken = await adapter.testConnection({ auth_type: 'API_TOKEN' });
    assert.equal(resNoToken.ok, false);

    const resNoCreds = await adapter.testConnection({ auth_type: 'SERVER_CREDENTIALS' });
    assert.equal(resNoCreds.ok, false);
  });
});
