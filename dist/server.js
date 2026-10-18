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
// French Academy API — Express 5 + PostgreSQL.
// The Next.js app (web/) proxies /api/* and /content/* here, so the browser only ever sees one origin.
const node_path_1 = __importDefault(require("node:path"));
const express_1 = __importDefault(require("express"));
const express_session_1 = __importDefault(require("express-session"));
const connect_pg_simple_1 = __importDefault(require("connect-pg-simple"));
const db = __importStar(require("./db"));
const store = __importStar(require("./store"));
const auth = __importStar(require("./auth"));
const coach = __importStar(require("./coach"));
const mail = __importStar(require("./mail"));
const RESET_MINUTES = 60;
const MIN = 60_000;
// Reset links always use the configured public URL — never the request's Host header (host-header injection).
const resetLink = (token) => `${store.settings().publicUrl.replace(/\/+$/, '')}/reset-password?token=${token}`;
const PORT = Number(process.env.API_PORT || process.env.PORT) || 4000;
const HOST = process.env.API_HOST || '127.0.0.1'; // only the Next.js server needs to reach it
const CONTENT_DIR = node_path_1.default.join(__dirname, '..', 'content');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
async function main() {
    await db.migrate();
    await store.loadSettings();
    store.resets.purgeOld().catch(() => { });
    const app = (0, express_1.default)();
    const PgSession = (0, connect_pg_simple_1.default)(express_session_1.default);
    app.disable('x-powered-by');
    // Which proxies to trust for client IP / HTTPS: the local Next.js proxy by default.
    // Hosted (e.g. Render behind Vercel) set TRUST_PROXY=true so req.secure sees X-Forwarded-Proto: https.
    const tp = process.env.TRUST_PROXY;
    app.set('trust proxy', tp === undefined || tp === '' ? 'loopback' : tp === 'true' ? true : /^\d+$/.test(tp) ? Number(tp) : tp);
    // Liveness for the host / uptime pings. Registered before sessions so it never touches the database
    // (pinging it keeps a sleeping free web service awake without keeping a serverless DB awake too).
    app.get('/api/health', (req, res) => { res.json({ ok: true }); });
    app.use(express_1.default.json({ limit: '2mb' }));
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-store');
        next();
    });
    // Sessions live in Postgres, so logins survive restarts.
    app.use((0, express_session_1.default)({
        name: 'fa.sid',
        store: new PgSession({ pool: db.pool, tableName: 'session', createTableIfMissing: false, pruneSessionInterval: 60 * 60 }),
        secret: process.env.SESSION_SECRET || store.settings().sessionSecret,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', maxAge: 1000 * 60 * 60 * 24 * 14 }
    }));
    // Mutating calls must be JSON. With SameSite=strict this closes off CSRF via plain forms.
    app.use('/api', (req, res, next) => {
        if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
            res.status(415).json({ error: 'JSON only' });
            return;
        }
        next();
    });
    // Protected course content (weeks, mocks, themes…).
    app.use('/content', auth.requireAuth, express_1.default.static(CONTENT_DIR, { fallthrough: false }));
    // ---- Public auth endpoints ----
    app.get('/api/status', async (req, res) => {
        const me = await auth.currentUser(req);
        const status = {
            needsSetup: (await store.users.count()) === 0,
            loggedIn: !!me,
            role: me ? me.role : null,
            allowRegistration: !!store.settings().allowRegistration,
            emailReset: mail.isMailConfigured()
        };
        res.json(status);
    });
    const startSession = (req, res, userId, redirect) => req.session.regenerate(err => {
        if (err) {
            res.status(500).json({ error: 'Session error' });
            return;
        }
        req.session.userId = userId;
        res.json({ ok: true, redirect });
    });
    app.post('/api/setup', async (req, res) => {
        if ((await store.users.count()) > 0) {
            res.status(403).json({ error: 'Setup already done.' });
            return;
        }
        try {
            const { username, password, name } = body(req);
            const user = await auth.createUser({ username, password, name, role: 'admin' });
            startSession(req, res, user.id, '/admin');
        }
        catch (e) {
            // A concurrent second setup loses the unique race — report it as "already done".
            if (e.code === '23505') {
                res.status(403).json({ error: 'Setup already done.' });
                return;
            }
            if (e instanceof auth.InputError) {
                res.status(400).json({ error: e.message });
                return;
            }
            throw e;
        }
    });
    // Two separate sign-ins: learners at /login, admins at /admin/login. Each only accepts its own role.
    const signIn = (portal) => async (req, res) => {
        const { username, password } = body(req);
        const lockKey = portal + ':' + String(username ?? '');
        if (auth.isLocked(req, lockKey)) {
            res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
            return;
        }
        const user = await auth.verify(username, password);
        if (!user) {
            auth.noteFail(req, lockKey);
            res.status(401).json({ error: 'Wrong username or password.' });
            return;
        }
        // Only reached with the right password, so these messages don't reveal anything to a guesser.
        if (!user.isActive) {
            res.status(403).json({ error: 'This account is disabled. Contact the administrator.' });
            return;
        }
        if (portal === 'learner' && user.role === 'admin') {
            res.status(403).json({ error: 'This is the learner sign-in. Administrators sign in at /admin/login.', redirect: '/admin/login' });
            return;
        }
        if (portal === 'admin' && user.role !== 'admin') {
            res.status(403).json({ error: 'This sign-in is for administrators only. Learners sign in at /login.', redirect: '/login' });
            return;
        }
        auth.clearFails(req, lockKey);
        await store.users.touchLogin(user.id);
        const diag = user.role === 'admin' ? null : (await store.getProgress(user.id)).diagnostic;
        startSession(req, res, user.id, auth.landingFor(user, !!diag));
    };
    app.post('/api/login', signIn('learner'));
    app.post('/api/admin/login', signIn('admin'));
    // Self-registration: only while the admin has sign-ups switched on. Always creates a learner.
    app.post('/api/register', async (req, res) => {
        if (!store.settings().allowRegistration) {
            res.status(403).json({ error: 'Sign-ups are closed. Ask the admin for an account.' });
            return;
        }
        if ((await store.users.count()) === 0) {
            res.status(403).json({ error: 'Create the admin account first.' });
            return;
        }
        if (auth.rateLimited('register|' + req.ip, 5, 60 * MIN)) {
            res.status(429).json({ error: 'Too many sign-ups from here. Try again later.' });
            return;
        }
        try {
            const { username, password, name, email } = body(req);
            const user = await auth.createUser({ username, password, name, email, role: 'learner' });
            startSession(req, res, user.id, '/welcome');
        }
        catch (e) {
            if (e instanceof auth.InputError) {
                res.status(400).json({ error: e.message });
                return;
            }
            if (e.code === '23505') {
                res.status(400).json({ error: 'That username or email is already taken.' });
                return;
            }
            throw e;
        }
    });
    // Forgot password: always the same answer, so it can't be used to discover who has an account.
    // The email is sent in the background so response time doesn't leak it either.
    const FORGOT_OK = { ok: true, message: 'If that account exists and has an email address, a reset link is on its way. Check your inbox (and spam) — the link works for 1 hour.' };
    app.post('/api/password/forgot', async (req, res) => {
        const id = String(body(req).identifier ?? '').trim().toLowerCase().slice(0, 254);
        if (!id) {
            res.status(400).json({ error: 'Enter your username or email.' });
            return;
        }
        if (!mail.isMailConfigured()) {
            res.status(503).json({ error: 'Email reset isn’t set up on this site. Ask the admin for a reset link.' });
            return;
        }
        if (auth.rateLimited('forgot-ip|' + req.ip, 5, 15 * MIN) || auth.rateLimited('forgot-id|' + id, 3, 60 * MIN)) {
            res.status(429).json({ error: 'Too many requests. Try again later.' });
            return;
        }
        res.json(FORGOT_OK);
        try {
            const user = id.includes('@') ? await store.users.byEmail(id) : await auth.findUser(id);
            if (!user?.email)
                return;
            const { token, hash } = auth.newResetToken();
            await store.resets.create(user.id, hash, RESET_MINUTES, 'self');
            const m = mail.resetEmail(user.name, resetLink(token), RESET_MINUTES);
            await mail.send(user.email, m.subject, m.text, m.html);
        }
        catch (err) {
            console.error('Reset email failed:', err.message);
        }
    });
    app.post('/api/password/check', async (req, res) => {
        const token = String(body(req).token ?? '');
        res.json({ valid: token.length > 20 && !!(await store.resets.peek(auth.hashToken(token))) });
    });
    app.post('/api/password/reset', async (req, res) => {
        if (auth.rateLimited('reset|' + req.ip, 20, 15 * MIN)) {
            res.status(429).json({ error: 'Too many attempts. Try again later.' });
            return;
        }
        const { token, password } = body(req);
        let hash;
        try {
            hash = await auth.hashPassword(password);
        }
        catch (e) {
            res.status(400).json({ error: e.message });
            return;
        }
        const userId = await store.resets.consume(auth.hashToken(String(token ?? '')), hash);
        if (!userId) {
            res.status(400).json({ error: 'This reset link is invalid, expired or already used. Ask for a new one.' });
            return;
        }
        res.json({ ok: true, message: 'Password changed. You’ve been logged out everywhere — log in with the new password.' });
    });
    app.post('/api/logout', (req, res) => {
        req.session.destroy(() => { res.clearCookie('fa.sid'); res.json({ ok: true }); });
    });
    // ---- Everything below needs a login ----
    app.use('/api', auth.requireAuth);
    app.get('/api/me', (req, res) => {
        const s = store.settings();
        const me = {
            user: auth.publicUser(req.user),
            feedbackMode: auth.effectiveMode(req.user),
            allowUserOverride: !!s.allowUserOverride,
            aiConfigured: coach.isConfigured(),
            aiProvider: coach.PROVIDERS[coach.activeProvider()].label,
            startDate: req.user.startDate || s.startDate,
            examDate: req.user.examDate || s.examDate,
            needsOnboarding: auth.needsOnboarding(req.user),
            defaultExamDate: s.examDate
        };
        res.json(me);
    });
    app.put('/api/me', async (req, res) => {
        const { name, voice, feedbackOverride, currentPassword, newPassword, email, startDate, examDate } = body(req);
        const patch = {};
        if (req.user.role === 'admin' && (startDate !== undefined || examDate !== undefined || feedbackOverride !== undefined)) {
            res.status(403).json({ error: 'Plan dates and feedback mode are learner settings.' });
            return;
        }
        // Plan dates: start is required once set; exam may be cleared (null → site default). Exam must be after start.
        if (startDate !== undefined || examDate !== undefined) {
            const start = startDate !== undefined ? startDate : req.user.startDate;
            const exam = examDate !== undefined ? (examDate || null) : req.user.examDate;
            if (typeof start !== 'string' || !DATE.test(start) || isNaN(Date.parse(start))) {
                res.status(400).json({ error: 'Choose a valid start date.' });
                return;
            }
            if (exam !== null && (typeof exam !== 'string' || !DATE.test(exam) || isNaN(Date.parse(exam)))) {
                res.status(400).json({ error: 'Choose a valid exam date.' });
                return;
            }
            const effExam = exam || store.settings().examDate;
            if (effExam <= start) {
                res.status(400).json({ error: 'The exam date must be after your start date.' });
                return;
            }
            patch.startDate = start;
            patch.examDate = exam;
        }
        if (typeof name === 'string' && name.trim())
            patch.name = name.trim().slice(0, 60);
        if (voice === 'fr-CA' || voice === 'fr-FR')
            patch.voice = voice;
        if (email !== undefined) {
            try {
                patch.email = await auth.cleanEmail(email, req.user.id);
            }
            catch (e) {
                res.status(400).json({ error: e.message });
                return;
            }
        }
        if (feedbackOverride !== undefined) {
            if (!store.settings().allowUserOverride) {
                res.status(403).json({ error: 'The admin has locked the feedback mode.' });
                return;
            }
            patch.feedbackOverride = feedbackOverride === 'ai' || feedbackOverride === 'selfmark' ? feedbackOverride : null;
        }
        if (newPassword) {
            if (!(await auth.verify(req.user.username, currentPassword))) {
                res.status(400).json({ error: 'Current password is wrong.' });
                return;
            }
            try {
                await auth.setPassword(req.user, newPassword);
            }
            catch (e) {
                res.status(400).json({ error: e.message });
                return;
            }
            await store.endSessions(req.user.id, req.sessionID); // other devices are logged out
        }
        const u = await store.users.update(req.user.id, patch);
        res.json({ ok: true, user: auth.publicUser(u), feedbackMode: auth.effectiveMode(u) });
    });
    app.get('/api/progress', auth.requireLearner, async (req, res) => { res.json(await store.getProgress(req.user.id)); });
    app.put('/api/progress', auth.requireLearner, async (req, res) => {
        try {
            await store.setProgress(req.user.id, body(req));
        }
        catch (e) {
            const code = e.code;
            if (code && /^2[23]/.test(code)) {
                res.status(400).json({ error: 'Invalid progress data: ' + e.message });
                return;
            }
            throw e;
        }
        res.json({ ok: true });
    });
    app.post('/api/feedback', auth.requireLearner, async (req, res) => {
        if (auth.effectiveMode(req.user) !== 'ai') {
            res.status(403).json({ error: 'AI feedback is switched off. Self-mark mode is active.' });
            return;
        }
        const { kind, task, prompt, text } = body(req);
        if (!text || String(text).trim().length < 10) {
            res.status(400).json({ error: 'Write (or transcribe) your attempt first.' });
            return;
        }
        try {
            res.json(await coach.feedback({ kind: kind === 'speaking' ? 'speaking' : 'writing', task, prompt, text: String(text) }));
        }
        catch (err) {
            const { status, message } = coach.describeError(err);
            res.status(status).json({ error: message });
        }
    });
    // ---- Admin ----
    app.get('/api/admin/settings', auth.requireAdmin, (req, res) => {
        const s = store.settings();
        const providers = {};
        for (const [id, def] of Object.entries(coach.PROVIDERS)) {
            const key = String(s[def.keyField] || '');
            providers[id] = { label: def.label, models: def.models, model: coach.modelFor(id), keySet: !!key, keyHint: key ? '…' + key.slice(-4) : '', envKey: !!process.env[def.env] };
        }
        const out = {
            feedbackMode: s.feedbackMode, allowUserOverride: s.allowUserOverride, aiProvider: coach.activeProvider(),
            providers, startDate: s.startDate, examDate: s.examDate,
            allowRegistration: s.allowRegistration, publicUrl: s.publicUrl,
            smtp: { host: s.smtpHost, port: s.smtpPort, secure: s.smtpSecure, user: s.smtpUser, from: s.smtpFrom, passSet: !!s.smtpPass, configured: mail.isMailConfigured() }
        };
        res.json(out);
    });
    app.put('/api/admin/settings', auth.requireAdmin, async (req, res) => {
        const b = body(req);
        const patch = {};
        if (b.feedbackMode === 'ai' || b.feedbackMode === 'selfmark')
            patch.feedbackMode = b.feedbackMode;
        if (typeof b.allowUserOverride === 'boolean')
            patch.allowUserOverride = b.allowUserOverride;
        if (b.aiProvider in coach.PROVIDERS)
            patch.aiProvider = b.aiProvider;
        if (typeof b.startDate === 'string' && DATE.test(b.startDate))
            patch.startDate = b.startDate;
        if (typeof b.examDate === 'string' && DATE.test(b.examDate))
            patch.examDate = b.examDate;
        if (typeof b.allowRegistration === 'boolean')
            patch.allowRegistration = b.allowRegistration;
        if (typeof b.publicUrl === 'string') {
            const u = b.publicUrl.trim().replace(/\/+$/, '');
            if (!/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(u)) {
                res.status(400).json({ error: 'Site address must start with http:// or https://' });
                return;
            }
            patch.publicUrl = u;
        }
        const sm = b.smtp;
        if (sm && typeof sm === 'object') {
            if (typeof sm.host === 'string')
                patch.smtpHost = sm.host.trim().slice(0, 200);
            if (Number.isInteger(sm.port) && sm.port > 0 && sm.port < 65536)
                patch.smtpPort = sm.port;
            if (typeof sm.secure === 'boolean')
                patch.smtpSecure = sm.secure;
            if (typeof sm.user === 'string')
                patch.smtpUser = sm.user.trim().slice(0, 200);
            if (typeof sm.from === 'string')
                patch.smtpFrom = sm.from.trim().slice(0, 200);
            if (typeof sm.pass === 'string' && sm.pass)
                patch.smtpPass = sm.pass;
            if (sm.clearPass === true)
                patch.smtpPass = '';
        }
        // Per-provider key + model: { providers: { openai: { key, model, clearKey } } }
        for (const [id, def] of Object.entries(coach.PROVIDERS)) {
            const v = (b.providers || {})[id];
            if (!v)
                continue;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const p = patch;
            if (typeof v.model === 'string' && /^[A-Za-z0-9._:/-]{2,80}$/.test(v.model.trim()))
                p[def.modelField] = v.model.trim();
            if (typeof v.key === 'string' && v.key.trim())
                p[def.keyField] = v.key.trim();
            if (v.clearKey === true)
                p[def.keyField] = '';
        }
        await store.updateSettings(patch);
        res.json({ ok: true });
    });
    app.post('/api/admin/test-ai', auth.requireAdmin, async (req, res) => {
        try {
            const r = await coach.test();
            res.json({ ok: true, provider: r.provider, model: r.model, score: r.score });
        }
        catch (err) {
            const { status, message } = coach.describeError(err);
            res.status(status).json({ error: message });
        }
    });
    app.post('/api/admin/test-email', auth.requireAdmin, async (req, res) => {
        const to = String(body(req).to ?? '').trim();
        if (!auth.validEmail(to)) {
            res.status(400).json({ error: 'Enter a valid address to send the test to.' });
            return;
        }
        try {
            await mail.send(to, 'French Academy — test email', 'SMTP works. Password reset emails will be sent from this address.', '<p>SMTP works. Password reset emails will be sent from this address.</p>');
            res.json({ ok: true });
        }
        catch (e) {
            res.status(502).json({ error: 'Sending failed: ' + e.message });
        }
    });
    // Fallback when email isn't set up: the admin creates a one-time link and sends it however they like.
    app.post('/api/admin/users/:id/reset-link', auth.requireAdmin, async (req, res) => {
        const u = await auth.findById(String(req.params.id));
        if (!u) {
            res.status(404).json({ error: 'No such user' });
            return;
        }
        const { token, hash } = auth.newResetToken();
        await store.resets.create(u.id, hash, RESET_MINUTES, 'admin');
        res.json({ link: resetLink(token), minutes: RESET_MINUTES });
    });
    app.get('/api/admin/learners', auth.requireAdmin, async (req, res) => {
        res.json(await store.learnersOverview());
    });
    app.get('/api/admin/users', auth.requireAdmin, async (req, res) => {
        res.json((await store.users.list()).map(auth.publicUser));
    });
    app.get('/api/admin/users/:id', auth.requireAdmin, async (req, res) => {
        const u = await auth.findById(String(req.params.id));
        if (!u) {
            res.status(404).json({ error: 'No such user' });
            return;
        }
        res.json(auth.publicUser(u));
    });
    app.post('/api/admin/users', auth.requireAdmin, async (req, res) => {
        try {
            const b = body(req);
            let u = await auth.createUser(b);
            if (b.isActive === false)
                u = await store.users.update(u.id, { isActive: false });
            res.json(auth.publicUser(u));
        }
        catch (e) {
            if (e instanceof auth.InputError) {
                res.status(400).json({ error: e.message });
                return;
            }
            if (e.code === '23505') {
                res.status(400).json({ error: 'That username or email is already taken.' });
                return;
            }
            throw e;
        }
    });
    app.put('/api/admin/users/:id', auth.requireAdmin, async (req, res) => {
        const u = await auth.findById(String(req.params.id));
        if (!u) {
            res.status(404).json({ error: 'No such user' });
            return;
        }
        const self = u.id === req.user.id;
        const { password, role, name, email, username, isActive } = body(req);
        const patch = {};
        const fail = (msg) => { res.status(400).json({ error: msg }); };
        if (username !== undefined && auth.normUsername(username) !== u.username) {
            const nu = auth.normUsername(username);
            if (!auth.validUsername(nu))
                return fail('Username: 3–32 chars, letters, numbers, dot, dash, underscore.');
            if (await auth.findUser(nu))
                return fail('That username already exists.');
            patch.username = nu;
        }
        if (typeof name === 'string') {
            if (!name.trim())
                return fail('Name cannot be empty.');
            patch.name = name.trim().slice(0, 60);
        }
        if (email !== undefined) {
            try {
                patch.email = await auth.cleanEmail(email, u.id);
            }
            catch (e) {
                return fail(e.message);
            }
        }
        const losesAdmin = u.role === 'admin' && u.isActive && ((role !== undefined && role !== 'admin') || isActive === false);
        if (losesAdmin && self)
            return fail('You can’t demote or disable your own account — ask another admin.');
        if (losesAdmin && (await store.users.countAdmins()) === 1)
            return fail('There must always be at least one active admin.');
        if (role === 'admin' || role === 'learner')
            patch.role = role;
        if (typeof isActive === 'boolean')
            patch.isActive = isActive;
        if (password) {
            try {
                patch.hash = await auth.hashPassword(password);
            }
            catch (e) {
                return fail(e.message);
            }
        }
        let updated;
        try {
            updated = await store.users.update(u.id, patch);
        }
        catch (e) {
            if (e.code === '23505')
                return fail('That username or email is already taken.');
            throw e;
        }
        // New password or disabled account → signed out everywhere (keep the admin's own session).
        if (patch.hash || patch.isActive === false)
            await store.endSessions(u.id, self ? req.sessionID : undefined);
        res.json(auth.publicUser(updated));
    });
    app.delete('/api/admin/users/:id', auth.requireAdmin, async (req, res) => {
        const u = await auth.findById(String(req.params.id));
        if (!u) {
            res.status(404).json({ error: 'No such user' });
            return;
        }
        if (u.id === req.user.id) {
            res.status(400).json({ error: 'You cannot delete yourself.' });
            return;
        }
        if (u.role === 'admin' && u.isActive && (await store.users.countAdmins()) === 1) {
            res.status(400).json({ error: 'There must always be at least one active admin.' });
            return;
        }
        await store.users.remove(u.id); // progress rows go with it (ON DELETE CASCADE)
        res.json({ ok: true });
    });
    app.use((req, res) => { res.status(404).json({ error: 'Not found' }); });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err, req, res, _next) => {
        // Client errors from middleware (static 404/403 on traversal attempts, bad JSON 400…): report, don't log as crashes.
        if (err.status && err.status >= 400 && err.status < 500) {
            res.status(err.status).json({ error: err.status === 404 ? 'Not found' : err.status === 403 ? 'Forbidden' : 'Bad request' });
            return;
        }
        console.error(err);
        if (res.headersSent)
            return;
        res.status(500).json({ error: err.code === 'ECONNREFUSED' ? 'Database unavailable.' : 'Server error.' });
    });
    app.listen(PORT, HOST, async () => {
        console.log(`French Academy API on http://${HOST}:${PORT} (PostgreSQL)`);
        if ((await store.users.count()) === 0)
            console.log('No users yet — open the web app to create the admin account.');
    });
}
main().catch((err) => {
    console.error('Startup failed:', err.message);
    if (err.code === '28P01')
        console.error('→ Wrong database password in DATABASE_URL, or the role does not exist yet. Run: npm run db:setup');
    if (err.code === '3D000')
        console.error('→ The database does not exist yet. Run: npm run db:setup');
    if (err.code === 'ECONNREFUSED')
        console.error('→ PostgreSQL is not running or not on that host/port.');
    process.exit(1);
});
//# sourceMappingURL=server.js.map