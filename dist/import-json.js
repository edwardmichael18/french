"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// npm run db:import [path/to/db.json] — one-off import from the old JSON-file store into PostgreSQL.
// Skips usernames that already exist, so it is safe to re-run.
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const db = __importStar(require("./db"));
const store = __importStar(require("./store"));
(async () => {
    const file = process.argv[2] || node_path_1.default.join(__dirname, '..', '..', 'data', 'db.json');
    if (!node_fs_1.default.existsSync(file)) {
        console.log(`Nothing to import: ${file} not found.`);
        process.exit(0);
    }
    const old = JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
    await db.migrate();
    await store.loadSettings();
    const s = old.settings || {};
    const patch = {};
    for (const k of ['feedbackMode', 'allowUserOverride', 'aiProvider', 'anthropicApiKey', 'openaiApiKey', 'geminiApiKey',
        'claudeModel', 'openaiModel', 'geminiModel', 'startDate', 'examDate'])
        if (s[k] !== undefined && s[k] !== '')
            patch[k] = s[k];
    await store.updateSettings(patch);
    console.log('Settings imported:', Object.keys(patch).join(', ') || '(none)');
    let added = 0, skipped = 0;
    for (const u of old.users || []) {
        if (await store.users.byUsername(u.username)) {
            skipped++;
            continue;
        }
        await store.users.create({ id: u.id, username: u.username, name: u.name, hash: u.hash, role: u.role, voice: u.voice, createdAt: u.createdAt });
        if (u.feedbackOverride)
            await store.users.update(u.id, { feedbackOverride: u.feedbackOverride });
        const p = (old.progress || {})[u.id];
        if (p)
            await store.setProgress(u.id, p);
        added++;
    }
    console.log(`Users imported: ${added}, skipped (already present): ${skipped}.`);
    await db.pool.end();
})().catch(e => { console.error('Import failed:', e.message); process.exit(1); });
//# sourceMappingURL=import-json.js.map