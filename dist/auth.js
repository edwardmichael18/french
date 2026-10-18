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
exports.needsOnboarding = exports.landingFor = exports.publicUser = exports.hashToken = exports.newResetToken = exports.hashPassword = exports.InputError = exports.validEmail = exports.validUsername = exports.normUsername = exports.findById = exports.findUser = exports.clearFails = exports.isLocked = void 0;
exports.noteFail = noteFail;
exports.cleanEmail = cleanEmail;
exports.createUser = createUser;
exports.setPassword = setPassword;
exports.verify = verify;
exports.effectiveMode = effectiveMode;
exports.currentUser = currentUser;
exports.requireAuth = requireAuth;
exports.requireAdmin = requireAdmin;
exports.requireLearner = requireLearner;
exports.rateLimited = rateLimited;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const store = __importStar(require("./store"));
// ---- Rate limiting: 5 failed attempts per 15 minutes per IP+username,
// plus 20 per account from any address (behind hosting proxies the client IP comes from a header that can be faked).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const MAX_ACCOUNT_FAILS = 20;
const failures = new Map();
const keyFor = (req, username) => (req.ip || 'unknown') + '|' + String(username || '').toLowerCase();
const accountKey = (username) => 'account|' + String(username || '').toLowerCase();
function recentFails(key) {
    const now = Date.now();
    const list = (failures.get(key) || []).filter(t => now - t < WINDOW_MS);
    failures.set(key, list);
    return list;
}
const isLocked = (req, username) => recentFails(keyFor(req, username)).length >= MAX_FAILS || recentFails(accountKey(username)).length >= MAX_ACCOUNT_FAILS;
exports.isLocked = isLocked;
function noteFail(req, username) {
    for (const k of [keyFor(req, username), accountKey(username)])
        failures.set(k, [...recentFails(k), Date.now()]);
}
const clearFails = (req, username) => { failures.delete(keyFor(req, username)); failures.delete(accountKey(username)); };
exports.clearFails = clearFails;
// ---- Users ----
const norm = (u) => String(u || '').trim().toLowerCase();
const findUser = (username) => store.users.byUsername(norm(username));
exports.findUser = findUser;
const findById = (id) => store.users.byId(id);
exports.findById = findById;
exports.normUsername = norm;
const validUsername = (u) => /^[a-z0-9._-]{3,32}$/.test(u);
exports.validUsername = validUsername;
const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;
const validEmail = (e) => e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
exports.validEmail = validEmail;
class InputError extends Error {
}
exports.InputError = InputError;
// Optional email: '' → null; otherwise must be valid and not used by another account.
async function cleanEmail(email, exceptUserId) {
    const e = String(email ?? '').trim();
    if (!e)
        return null;
    if (!(0, exports.validEmail)(e))
        throw new InputError('That email address doesn’t look right.');
    const other = await store.users.byEmail(e);
    if (other && other.id !== exceptUserId)
        throw new InputError('That email is already used by another account.');
    return e;
}
async function createUser({ username, password, name, role, email }) {
    const u = norm(username);
    if (!(0, exports.validUsername)(u))
        throw new InputError('Username: 3–32 chars, letters, numbers, dot, dash, underscore.');
    if (!validPassword(password))
        throw new InputError('Password must be at least 8 characters.');
    if (await (0, exports.findUser)(u))
        throw new InputError('That username already exists.');
    return store.users.create({
        id: node_crypto_1.default.randomUUID(),
        username: u,
        name: String(name || u).slice(0, 60),
        hash: await bcryptjs_1.default.hash(password, 12),
        role: role === 'admin' ? 'admin' : 'learner',
        email: await cleanEmail(email)
    });
}
const hashPassword = (p) => {
    if (!validPassword(p))
        throw new InputError('Password must be at least 8 characters.');
    return bcryptjs_1.default.hash(p, 12);
};
exports.hashPassword = hashPassword;
// Reset tokens: 32 random bytes, URL-safe; only the SHA-256 hash is stored.
const newResetToken = () => {
    const token = node_crypto_1.default.randomBytes(32).toString('base64url');
    return { token, hash: (0, exports.hashToken)(token) };
};
exports.newResetToken = newResetToken;
const hashToken = (t) => node_crypto_1.default.createHash('sha256').update(t).digest('hex');
exports.hashToken = hashToken;
async function setPassword(user, password) {
    return store.users.update(user.id, { hash: await (0, exports.hashPassword)(password) });
}
let DUMMY_HASH = null;
async function verify(username, password) {
    const user = await (0, exports.findUser)(username);
    // Always run a compare so timing doesn't reveal whether the user exists.
    DUMMY_HASH ??= await bcryptjs_1.default.hash('not-a-real-password', 12);
    const ok = await bcryptjs_1.default.compare(String(password || ''), user ? user.hash : DUMMY_HASH);
    return ok && user ? user : null;
}
// ---- Effective feedback mode: always exactly one value ----
function effectiveMode(user) {
    const s = store.settings();
    if (s.allowUserOverride && user && (user.feedbackOverride === 'ai' || user.feedbackOverride === 'selfmark'))
        return user.feedbackOverride;
    return s.feedbackMode === 'ai' ? 'ai' : 'selfmark';
}
// ---- Middleware ----
// A disabled account counts as logged out, even if it still has a session.
async function currentUser(req) {
    const u = req.session?.userId ? await (0, exports.findById)(req.session.userId) : null;
    return u && u.isActive ? u : null;
}
async function requireAuth(req, res, next) {
    const user = await currentUser(req);
    if (!user) {
        res.status(401).json({ error: 'Not logged in' });
        return;
    }
    req.user = user;
    next();
}
async function requireAdmin(req, res, next) {
    const user = await currentUser(req);
    if (!user) {
        res.status(401).json({ error: 'Not logged in' });
        return;
    }
    if (user.role !== 'admin') {
        res.status(403).json({ error: 'Admins only' });
        return;
    }
    req.user = user;
    next();
}
const publicUser = (u) => ({
    id: u.id, username: u.username, name: u.name, role: u.role, createdAt: u.createdAt, voice: u.voice, feedbackOverride: u.feedbackOverride, email: u.email,
    startDate: u.startDate, examDate: u.examDate, isActive: u.isActive, lastLoginAt: u.lastLoginAt
});
exports.publicUser = publicUser;
// Where to send someone right after they log in / sign up. Admins manage the site; they don't study.
const landingFor = (u, hasDiagnostic) => u.role === 'admin' ? '/admin' : !u.startDate ? '/welcome' : hasDiagnostic ? '/dashboard' : '/diagnostic';
exports.landingFor = landingFor;
const needsOnboarding = (u) => u.role !== 'admin' && !u.startDate;
exports.needsOnboarding = needsOnboarding;
// Learner-only endpoints (progress, AI marking): admins have no learner data.
async function requireLearner(req, res, next) {
    const user = req.user ?? await currentUser(req);
    if (!user) {
        res.status(401).json({ error: 'Not logged in' });
        return;
    }
    if (user.role === 'admin') {
        res.status(403).json({ error: 'Admin accounts don’t have learner progress. Create a learner account to study.' });
        return;
    }
    req.user = user;
    next();
}
// ---- Generic per-key rate limiter (register, forgot-password) ----
const buckets = new Map();
function rateLimited(key, max, windowMs) {
    const now = Date.now();
    const list = (buckets.get(key) || []).filter(t => now - t < windowMs);
    const limited = list.length >= max;
    if (!limited)
        list.push(now);
    buckets.set(key, list);
    return limited;
}
//# sourceMappingURL=auth.js.map