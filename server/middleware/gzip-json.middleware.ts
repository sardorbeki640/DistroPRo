import { gzip } from 'node:zlib';
import type { RequestHandler, Response } from 'express';

/** Compress sizeable JSON API responses to reduce Render public egress. */
export const gzipJsonResponses: RequestHandler = (req, res, next) => {
  // Keep cached gzip and identity responses separate in browsers and proxies.
  res.vary('Accept-Encoding');
  if (!/\bgzip\b/i.test(req.headers['accept-encoding'] || '')) return next();
  const send = res.send.bind(res);
  res.send = ((body?: any): Response => {
    const contentType = String(res.getHeader('Content-Type') || '');
    if (req.method === 'HEAD' || !contentType.toLowerCase().includes('application/json') || res.getHeader('Content-Encoding')
      || [204, 304].includes(res.statusCode) || body == null) return send(body);

    const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    if (raw.length < 1024) return send(body);
    gzip(raw, { level: 1 }, (error, compressed) => {
      if (error) return send(body);
      res.setHeader('Content-Encoding', 'gzip');
      res.removeHeader('Content-Length');
      send(compressed);
    });
    return res;
  }) as typeof res.send;
  next();
};
