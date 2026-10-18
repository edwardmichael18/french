// npm run db:psql — opens psql on the app database as the app role (password taken from DATABASE_URL).
// Try: SELECT * FROM v_mock_best;  SELECT * FROM v_weekly_production_share;  \dt  \dv
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const u = new URL(process.env.DATABASE_URL);
let psql = process.env.PSQL || 'psql';
const base = 'C:\\Program Files\\PostgreSQL';
if (!process.env.PSQL && process.platform === 'win32' && fs.existsSync(base)) {
  const v = fs.readdirSync(base).filter(x => /^\d+$/.test(x)).sort((a, b) => b - a)[0];
  if (v) psql = path.join(base, v, 'bin', 'psql.exe');
}
const r = spawnSync(psql, ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username), '-d', u.pathname.slice(1)], {
  stdio: 'inherit', env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) }
});
process.exit(r.status == null ? 1 : r.status);
