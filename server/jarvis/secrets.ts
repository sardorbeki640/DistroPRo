import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/** AES-256-GCM with a key derived from the server secret (JWT_SECRET in .env.local). Used for API keys and integration passwords. */
let cached: { secret: string; key: Buffer } | null = null;
function key(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) throw new Error('Server maxfiy kaliti (JWT_SECRET) sozlanmagan — API kalitini xavfsiz saqlab bo‘lmaydi.');
  if (cached?.secret !== secret) cached = { secret, key: scryptSync(secret, 'distro-pro-jarvis', 32) };
  return cached.key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptSecret(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(':');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Saqlangan kalit buzilgan. Qayta kiriting.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Saqlangan kalitni ochib bo‘lmadi (server kaliti o‘zgargan). Qayta kiriting.');
  }
}
