import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { errorHandler } from '../middleware/error.middleware.ts';

function response() {
  return {
    statusCode: 200,
    body: null as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; }
  };
}

test('unexpected server exceptions are reported as 500 without leaking internals', () => {
  const res = response();
  errorHandler(new Error('secret SQL and token details'), {} as Request, res as unknown as Response, () => {});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
  assert.doesNotMatch(res.body.error, /secret SQL|token details/);
});

test('known client errors keep their status and useful message', () => {
  const res = response();
  errorHandler(Object.assign(new Error('Noto‘g‘ri miqdor'), { status: 422 }), {} as Request, res as unknown as Response, () => {});
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.error, 'Noto‘g‘ri miqdor');
});
