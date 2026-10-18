// npm run db:setup — creates the app role + databases named in DATABASE_URL.
// Runs psql as a superuser (default "postgres"); psql itself prompts for that password,
// so it never passes through this script or gets stored anywhere.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set in .env'); process.exit(1); }
const u = new URL(url);
const appUser = decodeURIComponent(u.username);
const appPassword = decodeURIComponent(u.password);
const appDb = u.pathname.replace(/^\//, '');
const host = u.hostname || 'localhost';
const port = u.port || '5432';
const superUser = process.env.PG_SUPERUSER || 'postgres';

function findPsql() {
  if (process.env.PSQL) return process.env.PSQL;
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['psql'], { encoding: 'utf8' });
  if (which.status === 0) return which.stdout.split(/\r?\n/)[0].trim();
  const base = 'C:\\Program Files\\PostgreSQL';
  if (fs.existsSync(base)) {
    const versions = fs.readdirSync(base).filter(v => /^\d+$/.test(v)).sort((a, b) => b - a);
    for (const v of versions) {
      const p = path.join(base, v, 'bin', 'psql.exe');
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const psql = findPsql();
if (!psql) { console.error('psql not found. Set PSQL=/path/to/psql and retry.'); process.exit(1); }
console.log(`Using ${psql}\nCreating role "${appUser}" and databases "${appDb}", "${appDb}_test" on ${host}:${port}.`);
console.log(`psql will ask for the password of the PostgreSQL superuser "${superUser}".\n`);

const r = spawnSync(psql, [
  '-h', host, '-p', port, '-U', superUser, '-d', 'postgres',
  '-v', `app_user=${appUser}`, '-v', `app_password=${appPassword}`, '-v', `app_db=${appDb}`,
  '-f', path.join(__dirname, '..', 'db', 'setup.sql')
], { stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
