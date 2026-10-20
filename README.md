# Distro Pro

Distro Pro is a finance and distribution management app. The React interface and Express API run together in one Node.js service; SQLite stores the company data.

## Local setup

Requirements: Node.js 24 and pnpm.

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
# Set JWT_SECRET in .env.local to a random value of at least 32 characters.
pnpm run dev
```

For a production build:

```powershell
pnpm run build
pnpm start
```

The production service must use the same `JWT_SECRET` on every restart. It encrypts saved integration credentials as well as signing login tokens. Changing it after setup makes previously saved integration credentials unreadable.

For a new, empty database, set `OWNER_EMAIL` and `OWNER_PASSWORD` before the first start. The initial owner password must be at least 12 characters. Keep `.env.local`, the SQLite database, photos, and backups private; they contain business data and credentials.

## Production server

The app requires persistent disk storage for SQLite and uploaded attendance photos. The included Oracle Cloud Ubuntu setup configures Node 24, systemd, HTTPS through Caddy, backups, and the persistent data directory.

See [deploy/README.md](deploy/README.md) for server setup, first data migration, code-only updates, and backup restore instructions. First migration (`-MigrateData`) stops the local app and copies its database and encryption key to the server; later deployments should omit that switch so server data stays in place.

## Health check

After deployment, `https://YOUR_DOMAIN/api/health` should return JSON with `"status":"ok"`.
