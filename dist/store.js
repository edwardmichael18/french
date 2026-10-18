"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.endSessions = exports.resets = exports.users = void 0;
exports.settings = settings;
exports.loadSettings = loadSettings;
exports.updateSettings = updateSettings;
exports.emptyProgress = emptyProgress;
exports.getProgress = getProgress;
exports.setProgress = setProgress;
exports.learnersOverview = learnersOverview;
const db_1 = require("./db");
const COLS = {
    feedbackMode: 'feedback_mode', allowUserOverride: 'allow_user_override', aiProvider: 'ai_provider',
    anthropicApiKey: 'anthropic_api_key', openaiApiKey: 'openai_api_key', geminiApiKey: 'gemini_api_key',
    claudeModel: 'claude_model', openaiModel: 'openai_model', geminiModel: 'gemini_model',
    startDate: 'start_date', examDate: 'exam_date', sessionSecret: 'session_secret',
    allowRegistration: 'allow_registration', publicUrl: 'public_url', smtpHost: 'smtp_host', smtpPort: 'smtp_port',
    smtpSecure: 'smtp_secure', smtpUser: 'smtp_user', smtpPass: 'smtp_pass', smtpFrom: 'smtp_from'
};
let settingsCache = null;
function settings() {
    if (!settingsCache)
        throw new Error('Settings not loaded yet');
    return settingsCache;
}
async function loadSettings() {
    const { rows } = await (0, db_1.query)('SELECT * FROM app_settings WHERE id');
    const r = rows[0];
    const s = {};
    for (const [k, col] of Object.entries(COLS))
        s[k] = r[col];
    settingsCache = s;
    return settingsCache;
}
async function updateSettings(patch) {
    const sets = [], params = [];
    for (const [k, v] of Object.entries(patch)) {
        if (!COLS[k] || k === 'sessionSecret')
            continue;
        params.push(v);
        sets.push(`${COLS[k]} = $${params.length}`);
    }
    if (sets.length)
        await (0, db_1.query)(`UPDATE app_settings SET ${sets.join(', ')}, updated_at = now() WHERE id`, params);
    return loadSettings();
}
const toUser = (r) => r ? ({
    id: r.id, username: r.username, name: r.name, hash: r.password_hash, role: r.role,
    voice: r.voice, feedbackOverride: r.feedback_override, email: r.email,
    startDate: r.start_date, examDate: r.exam_date, isActive: r.is_active,
    lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null, createdAt: r.created_at.toISOString()
}) : null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
exports.users = {
    count: async () => Number((await (0, db_1.query)('SELECT count(*) FROM users')).rows[0].count),
    // Active admins only: a disabled admin can't rescue the site.
    countAdmins: async () => Number((await (0, db_1.query)("SELECT count(*) FROM users WHERE role = 'admin' AND is_active")).rows[0].count),
    touchLogin: async (id) => { await (0, db_1.query)('UPDATE users SET last_login_at = now() WHERE id = $1', [id]); },
    byUsername: async (u) => toUser((await (0, db_1.query)('SELECT * FROM users WHERE username = $1', [u])).rows[0]),
    byEmail: async (e) => toUser((await (0, db_1.query)('SELECT * FROM users WHERE lower(email) = lower($1)', [e])).rows[0]),
    byId: async (id) => UUID.test(id) ? toUser((await (0, db_1.query)('SELECT * FROM users WHERE id = $1', [id])).rows[0]) : null,
    list: async () => (await (0, db_1.query)('SELECT * FROM users ORDER BY created_at')).rows.map(r => toUser(r)),
    create: async (u) => toUser((await (0, db_1.query)(`INSERT INTO users (id, username, name, password_hash, role, voice, email, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [u.id, u.username, u.name, u.hash, u.role, u.voice || 'fr-CA', u.email || null, u.createdAt ? new Date(u.createdAt) : new Date()])).rows[0]),
    update: async (id, f) => {
        const map = {
            name: 'name', username: 'username', hash: 'password_hash', role: 'role', voice: 'voice', feedbackOverride: 'feedback_override',
            email: 'email', startDate: 'start_date', examDate: 'exam_date', isActive: 'is_active'
        };
        const sets = [], params = [];
        for (const [k, col] of Object.entries(map))
            if (k in f) {
                params.push(f[k]);
                sets.push(`${col} = $${params.length}`);
            }
        if (!sets.length)
            return (await exports.users.byId(id));
        params.push(id);
        return toUser((await (0, db_1.query)(`UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params)).rows[0]);
    },
    remove: async (id) => (await (0, db_1.query)('DELETE FROM users WHERE id = $1', [id])).rowCount
};
// ---------- Progress: relational tables <-> the client's progress object ----------
const iso = (d) => (d instanceof Date ? d.toISOString() : String(d));
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null; };
const ts = (v) => { const d = new Date(v); return isNaN(d.getTime()) ? new Date() : d; };
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);
const str = (v, n) => String(v ?? '').slice(0, n);
// Keep only the first object with each id.
const uniqById = (list) => { const seen = new Set(); return list.filter(x => x && x.id && !seen.has(x.id) && seen.add(x.id)); };
function emptyProgress() {
    return {
        lessons: {}, quizzes: {}, checklist: {}, selfchecks: {}, wellbeing: {}, floorDays: [], studyLog: [],
        weakAreas: {}, errorLog: [], mocks: {}, diagnostic: null, writings: [], speaking: []
    };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
async function getProgress(userId) {
    const p = emptyProgress();
    const q = (sql) => (0, db_1.query)(sql, [userId]).then(r => r.rows);
    const [lessons, quizzes, checklist, floor, study, weak, errors, mocks, subs, docs] = await Promise.all([
        q('SELECT * FROM lesson_progress WHERE user_id = $1'),
        q('SELECT * FROM quiz_attempts WHERE user_id = $1 ORDER BY taken_at, id'),
        q('SELECT * FROM checklist_items WHERE user_id = $1'),
        q('SELECT day FROM floor_days WHERE user_id = $1 ORDER BY day'),
        q('SELECT day, minutes, kind FROM study_log WHERE user_id = $1 ORDER BY day, id'),
        q('SELECT trap, misses FROM weak_areas WHERE user_id = $1'),
        q('SELECT * FROM error_log WHERE user_id = $1 ORDER BY created_at'),
        q('SELECT * FROM mock_attempts WHERE user_id = $1 ORDER BY started_at'),
        q('SELECT * FROM submissions WHERE user_id = $1 ORDER BY created_at'),
        q('SELECT doc, value FROM user_documents WHERE user_id = $1')
    ]);
    for (const r of lessons)
        p.lessons['w' + r.week] = { step: r.step, done: r.done, answers: r.answers || {}, ...(r.done_at ? { doneAt: iso(r.done_at) } : {}) };
    for (const r of quizzes)
        (p.quizzes[r.quiz_id] ||= []).push({ score: r.score, total: r.total, at: iso(r.taken_at) });
    for (const r of checklist)
        p.checklist[r.item_id] = r.done;
    p.floorDays = floor.map(r => r.day);
    p.studyLog = study.map(r => ({ date: r.day, minutes: r.minutes, kind: r.kind }));
    for (const r of weak)
        p.weakAreas[r.trap] = r.misses;
    p.errorLog = errors.map(r => ({ id: r.id, wrote: r.wrote, correction: r.correction, rule: r.rule, count: r.count, at: iso(r.created_at) }));
    for (const r of mocks)
        (p.mocks[r.test_id] ||= []).push({ at: iso(r.started_at), co: r.co, ce: r.ce, ee: r.ee, eo: r.eo, criteria: r.criteria });
    for (const r of subs) {
        const s = { id: r.id, task: r.task, text: r.text, words: r.words, score: r.score, at: iso(r.created_at), mode: r.mode, ...(r.nclc ? { nclc: r.nclc } : {}) };
        p[r.kind === 'writing' ? 'writings' : 'speaking'].push(s);
    }
    for (const r of docs)
        p[r.doc] = r.value ?? (r.doc === 'diagnostic' ? null : {});
    return p;
}
// Each key the client sends replaces that part of the user's progress, inside one transaction.
const WRITERS = {
    lessons: async (c, u, v) => {
        await c.query('DELETE FROM lesson_progress WHERE user_id = $1', [u]);
        const rows = Object.entries(v || {}).map(([k, l]) => {
            const w = num(k.replace(/^w/, ''), 1, 21);
            return w && [u, w, num(l?.step, 0, 999) || 0, !!l?.done, l?.doneAt ? ts(l.doneAt) : null, JSON.stringify(l?.answers || {})];
        }).filter(Boolean);
        await (0, db_1.insertMany)(c, 'lesson_progress', ['user_id', 'week', 'step', 'done', 'done_at', 'answers'], rows);
    },
    quizzes: async (c, u, v) => {
        await c.query('DELETE FROM quiz_attempts WHERE user_id = $1', [u]);
        const rows = [];
        for (const [id, list] of Object.entries(v || {}))
            for (const a of [].concat(list || []))
                rows.push([u, str(id, 120), num(a.score, 0, 9999) || 0, num(a.total, 0, 9999) || 0, ts(a.at)]);
        await (0, db_1.insertMany)(c, 'quiz_attempts', ['user_id', 'quiz_id', 'score', 'total', 'taken_at'], rows);
    },
    checklist: async (c, u, v) => {
        await c.query('DELETE FROM checklist_items WHERE user_id = $1', [u]);
        await (0, db_1.insertMany)(c, 'checklist_items', ['user_id', 'item_id', 'done'], Object.entries(v || {}).map(([k, d]) => [u, str(k, 120), !!d]));
    },
    floorDays: async (c, u, v) => {
        await c.query('DELETE FROM floor_days WHERE user_id = $1', [u]);
        const days = [...new Set([].concat(v || []).map(day).filter(Boolean))];
        await (0, db_1.insertMany)(c, 'floor_days', ['user_id', 'day'], days.map(d => [u, d]));
    },
    studyLog: async (c, u, v) => {
        await c.query('DELETE FROM study_log WHERE user_id = $1', [u]);
        const rows = [].concat(v || []).filter(s => day(s?.date) && ['input', 'production'].includes(s.kind)).map(s => [u, s.date, num(s.minutes, 0, 1440) || 0, s.kind]);
        await (0, db_1.insertMany)(c, 'study_log', ['user_id', 'day', 'minutes', 'kind'], rows);
    },
    weakAreas: async (c, u, v) => {
        await c.query('DELETE FROM weak_areas WHERE user_id = $1', [u]);
        await (0, db_1.insertMany)(c, 'weak_areas', ['user_id', 'trap', 'misses'], Object.entries(v || {}).map(([k, n]) => [u, str(k, 60), num(n, 0, 1e6) || 0]));
    },
    errorLog: async (c, u, v) => {
        await c.query('DELETE FROM error_log WHERE user_id = $1', [u]);
        const rows = uniqById([].concat(v || [])).map(e => [str(e.id, 64), u, str(e.wrote, 1000), str(e.correction, 1000), str(e.rule, 300), num(e.count, 1, 1e6) || 1, ts(e.at)]);
        await (0, db_1.insertMany)(c, 'error_log', ['id', 'user_id', 'wrote', 'correction', 'rule', 'count', 'created_at'], rows);
    },
    mocks: async (c, u, v) => {
        await c.query('DELETE FROM mock_attempts WHERE user_id = $1', [u]);
        const rows = [], seen = new Set();
        const sc = (x, lo, hi) => (x == null || x === '' ? null : num(x, lo, hi));
        for (const [id, list] of Object.entries(v || {}))
            for (const m of [].concat(list || [])) {
                const at = ts(m.at), key = id + at.toISOString();
                if (seen.has(key))
                    continue;
                seen.add(key);
                rows.push([u, str(id, 40), at, sc(m.co, 100, 699), sc(m.ce, 100, 699), sc(m.ee, 0, 20), sc(m.eo, 0, 20), m.criteria == null ? null : str(m.criteria, 20)]);
            }
        await (0, db_1.insertMany)(c, 'mock_attempts', ['user_id', 'test_id', 'started_at', 'co', 'ce', 'ee', 'eo', 'criteria'], rows);
    },
    writings: (c, u, v) => writeSubs(c, u, v, 'writing'),
    speaking: (c, u, v) => writeSubs(c, u, v, 'speaking'),
    diagnostic: (c, u, v) => writeDoc(c, u, 'diagnostic', v),
    selfchecks: (c, u, v) => writeDoc(c, u, 'selfchecks', v),
    wellbeing: (c, u, v) => writeDoc(c, u, 'wellbeing', v)
};
async function writeSubs(c, u, v, kind) {
    await c.query('DELETE FROM submissions WHERE user_id = $1 AND kind = $2', [u, kind]);
    const rows = uniqById([].concat(v || [])).map(s => [
        str(s.id, 64), u, kind, s.task == null ? null : str(s.task, 120), str(s.text, 5000),
        s.words == null ? null : num(s.words, 0, 1e6), s.score == null ? null : num(s.score, 0, 20),
        s.nclc == null ? null : str(s.nclc, 20), s.mode == null ? null : str(s.mode, 20), ts(s.at)
    ]);
    await (0, db_1.insertMany)(c, 'submissions', ['id', 'user_id', 'kind', 'task', 'text', 'words', 'score', 'nclc', 'mode', 'created_at'], rows);
}
async function writeDoc(c, u, doc, v) {
    await c.query(`INSERT INTO user_documents (user_id, doc, value, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, doc) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [u, doc, v == null ? null : JSON.stringify(v)]);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
async function setProgress(userId, patch) {
    await (0, db_1.tx)(async (c) => {
        for (const k of Object.keys(patch || {}))
            if (WRITERS[k])
                await WRITERS[k](c, userId, patch[k]);
    });
}
// ---------- Password resets (only a SHA-256 hash of each token is stored) ----------
exports.resets = {
    create: async (userId, tokenHash, ttlMinutes, by) => {
        // One live link at a time: older unused links stop working.
        await (0, db_1.query)('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
        await (0, db_1.query)('INSERT INTO password_resets (token_hash, user_id, expires_at, requested_by) VALUES ($1, $2, now() + make_interval(mins => $3), $4)', [tokenHash, userId, ttlMinutes, by]);
    },
    // User id if the token is live (unused and unexpired), else null.
    peek: async (tokenHash) => (await (0, db_1.query)('SELECT user_id FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()', [tokenHash])).rows[0]?.user_id ?? null,
    // Atomically: mark the token used, set the new password, kill other links and every session.
    consume: (tokenHash, newPasswordHash) => (0, db_1.tx)(async (c) => {
        const r = await c.query('UPDATE password_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id', [tokenHash]);
        const userId = r.rows[0]?.user_id;
        if (!userId)
            return null;
        await c.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, userId]);
        await c.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
        await c.query("DELETE FROM session WHERE sess->>'userId' = $1", [userId]);
        return userId;
    }),
    purgeOld: () => (0, db_1.query)("DELETE FROM password_resets WHERE expires_at < now() - interval '7 days'")
};
// Log a user out everywhere except (optionally) the current session — used after a password change.
const endSessions = (userId, exceptSid) => (0, db_1.query)("DELETE FROM session WHERE sess->>'userId' = $1 AND sid <> coalesce($2, '')", [userId, exceptSid ?? null]);
exports.endSessions = endSessions;
// ---------- Admin: one summary row per learner ----------
async function learnersOverview() {
    const { rows } = await (0, db_1.query)(`
    SELECT u.id, u.username, u.name, u.email, u.created_at, u.start_date, u.exam_date,
      EXISTS (SELECT 1 FROM user_documents d WHERE d.user_id = u.id AND d.doc = 'diagnostic' AND d.value IS NOT NULL) AS diagnostic_done,
      (SELECT count(*) FROM lesson_progress l WHERE l.user_id = u.id AND l.done) AS lessons_done,
      (SELECT max(l.week) FROM lesson_progress l WHERE l.user_id = u.id AND (l.done OR l.step > 0)) AS furthest_week,
      m.best_co, m.best_ce, m.best_ee, m.best_eo,
      coalesce((SELECT sum(minutes) FROM study_log s WHERE s.user_id = u.id AND s.kind = 'production' AND s.day > current_date - 7), 0) AS prod_7d,
      coalesce((SELECT sum(minutes) FROM study_log s WHERE s.user_id = u.id AND s.day > current_date - 7), 0) AS total_7d,
      greatest(
        (SELECT max(day) FROM study_log s WHERE s.user_id = u.id),
        (SELECT max(created_at)::date FROM submissions x WHERE x.user_id = u.id),
        (SELECT max(day) FROM floor_days f WHERE f.user_id = u.id)
      )::text AS last_active
    FROM users u
    LEFT JOIN LATERAL (
      SELECT max(co) AS best_co, max(ce) AS best_ce, max(ee) AS best_ee, max(eo) AS best_eo FROM mock_attempts a WHERE a.user_id = u.id
    ) m ON true
    WHERE u.role = 'learner'
    ORDER BY u.created_at`);
    return rows.map(r => ({
        id: r.id, username: r.username, name: r.name, email: r.email, createdAt: r.created_at.toISOString(),
        startDate: r.start_date, examDate: r.exam_date, diagnosticDone: r.diagnostic_done,
        lessonsDone: Number(r.lessons_done), furthestWeek: r.furthest_week,
        bestCo: r.best_co, bestCe: r.best_ce, bestEe: r.best_ee, bestEo: r.best_eo,
        productionMinutes7d: Number(r.prod_7d), totalMinutes7d: Number(r.total_7d), lastActive: r.last_active
    }));
}
//# sourceMappingURL=store.js.map