"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.query = query;
exports.tx = tx;
exports.migrate = migrate;
exports.insertMany = insertMany;
// PostgreSQL connection pool + schema bootstrap.
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const pg_1 = require("pg");
// DATE columns come back as 'YYYY-MM-DD' strings, not JS Dates shifted by the local timezone.
pg_1.types.setTypeParser(1082, (v) => v);
if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy api/.env.example to api/.env and fill it in (see README → Database).');
    process.exit(1);
}
exports.pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX) || 10,
    idleTimeoutMillis: 30_000,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: process.env.PGSSL_STRICT !== 'false' } : undefined
});
exports.pool.on('error', err => console.error('Postgres pool error:', err.message));
function query(text, params) {
    return exports.pool.query(text, params);
}
async function tx(fn) {
    const client = await exports.pool.connect();
    try {
        await client.query('BEGIN');
        const out = await fn(client);
        await client.query('COMMIT');
        return out;
    }
    catch (e) {
        await client.query('ROLLBACK').catch(() => { });
        throw e;
    }
    finally {
        client.release();
    }
}
// db/ sits next to src/ (dev) and next to dist/ (build).
const DB_DIR = node_path_1.default.join(__dirname, '..', 'db');
// Runs db/schema.sql (idempotent), then any db/migrations/*.sql not yet applied, then seeds settings.
async function migrate() {
    await exports.pool.query(node_fs_1.default.readFileSync(node_path_1.default.join(DB_DIR, 'schema.sql'), 'utf8'));
    const migDir = node_path_1.default.join(DB_DIR, 'migrations');
    if (node_fs_1.default.existsSync(migDir)) {
        const done = new Set((await exports.pool.query('SELECT version FROM schema_migrations')).rows.map(r => r.version));
        for (const f of node_fs_1.default.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
            if (done.has(f))
                continue;
            await tx(async (c) => {
                await c.query(node_fs_1.default.readFileSync(node_path_1.default.join(migDir, f), 'utf8'));
                await c.query('INSERT INTO schema_migrations(version) VALUES ($1)', [f]);
            });
            console.log('Applied migration', f);
        }
    }
    await exports.pool.query('INSERT INTO app_settings (id, session_secret) VALUES (true, $1) ON CONFLICT (id) DO NOTHING', [node_crypto_1.default.randomBytes(32).toString('hex')]);
}
// Multi-row INSERT, chunked to stay under Postgres' 65,535-parameter limit.
async function insertMany(client, table, cols, rows) {
    if (!rows.length)
        return;
    const per = Math.max(1, Math.floor(60_000 / cols.length));
    for (let i = 0; i < rows.length; i += per) {
        const chunk = rows.slice(i, i + per);
        const params = [];
        const values = chunk.map(r => '(' + r.map(v => { params.push(v); return '$' + params.length; }).join(',') + ')');
        await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')}`, params);
    }
}
//# sourceMappingURL=db.js.map