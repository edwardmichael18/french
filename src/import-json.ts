// npm run db:import [path/to/db.json] — one-off import from the old JSON-file store into PostgreSQL.
// Skips usernames that already exist, so it is safe to re-run.
import fs from 'node:fs';
import path from 'node:path';
import * as db from './db';
import * as store from './store';

(async () => {
  const file = process.argv[2] || path.join(__dirname, '..', '..', 'data', 'db.json');
  if (!fs.existsSync(file)) { console.log(`Nothing to import: ${file} not found.`); process.exit(0); }
  const old = JSON.parse(fs.readFileSync(file, 'utf8'));
  await db.migrate();
  await store.loadSettings();

  const s = old.settings || {};
  const patch: Record<string, unknown> = {};
  for (const k of ['feedbackMode', 'allowUserOverride', 'aiProvider', 'anthropicApiKey', 'openaiApiKey', 'geminiApiKey',
    'claudeModel', 'openaiModel', 'geminiModel', 'startDate', 'examDate']) if (s[k] !== undefined && s[k] !== '') patch[k] = s[k];
  await store.updateSettings(patch);
  console.log('Settings imported:', Object.keys(patch).join(', ') || '(none)');

  let added = 0, skipped = 0;
  for (const u of old.users || []) {
    if (await store.users.byUsername(u.username)) { skipped++; continue; }
    await store.users.create({ id: u.id, username: u.username, name: u.name, hash: u.hash, role: u.role, voice: u.voice, createdAt: u.createdAt });
    if (u.feedbackOverride) await store.users.update(u.id, { feedbackOverride: u.feedbackOverride });
    const p = (old.progress || {})[u.id];
    if (p) await store.setProgress(u.id, p);
    added++;
  }
  console.log(`Users imported: ${added}, skipped (already present): ${skipped}.`);
  await db.pool.end();
})().catch(e => { console.error('Import failed:', e.message); process.exit(1); });
