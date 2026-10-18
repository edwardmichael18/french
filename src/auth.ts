import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { FeedbackMode, PublicUser } from '@fa/shared';
import * as store from './store';
import type { UserRow } from './store';

declare module 'express-session' {
  interface SessionData { userId?: string }
}
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: UserRow } }
}

// ---- Rate limiting: 5 failed attempts per 15 minutes per IP+username,
// plus 20 per account from any address (behind hosting proxies the client IP comes from a header that can be faked).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const MAX_ACCOUNT_FAILS = 20;
const failures = new Map<string, number[]>();

const keyFor = (req: Request, username: unknown) => (req.ip || 'unknown') + '|' + String(username || '').toLowerCase();
const accountKey = (username: unknown) => 'account|' + String(username || '').toLowerCase();
function recentFails(key: string) {
  const now = Date.now();
  const list = (failures.get(key) || []).filter(t => now - t < WINDOW_MS);
  failures.set(key, list);
  return list;
}
export const isLocked = (req: Request, username: unknown) =>
  recentFails(keyFor(req, username)).length >= MAX_FAILS || recentFails(accountKey(username)).length >= MAX_ACCOUNT_FAILS;
export function noteFail(req: Request, username: unknown) {
  for (const k of [keyFor(req, username), accountKey(username)]) failures.set(k, [...recentFails(k), Date.now()]);
}
export const clearFails = (req: Request, username: unknown) => { failures.delete(keyFor(req, username)); failures.delete(accountKey(username)); };

// ---- Users ----
const norm = (u: unknown) => String(u || '').trim().toLowerCase();
export const findUser = (username: unknown) => store.users.byUsername(norm(username));
export const findById = (id: string) => store.users.byId(id);

export const normUsername = norm;
export const validUsername = (u: string) => /^[a-z0-9._-]{3,32}$/.test(u);
const validPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= 8 && p.length <= 200;
export const validEmail = (e: string) => e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

export class InputError extends Error {}

// Optional email: '' → null; otherwise must be valid and not used by another account.
export async function cleanEmail(email: unknown, exceptUserId?: string): Promise<string | null> {
  const e = String(email ?? '').trim();
  if (!e) return null;
  if (!validEmail(e)) throw new InputError('That email address doesn’t look right.');
  const other = await store.users.byEmail(e);
  if (other && other.id !== exceptUserId) throw new InputError('That email is already used by another account.');
  return e;
}

export async function createUser({ username, password, name, role, email }: { username?: unknown; password?: unknown; name?: unknown; role?: unknown; email?: unknown }) {
  const u = norm(username);
  if (!validUsername(u)) throw new InputError('Username: 3–32 chars, letters, numbers, dot, dash, underscore.');
  if (!validPassword(password)) throw new InputError('Password must be at least 8 characters.');
  if (await findUser(u)) throw new InputError('That username already exists.');
  return store.users.create({
    id: crypto.randomUUID(),
    username: u,
    name: String(name || u).slice(0, 60),
    hash: await bcrypt.hash(password, 12),
    role: role === 'admin' ? 'admin' : 'learner',
    email: await cleanEmail(email)
  });
}

export const hashPassword = (p: unknown) => {
  if (!validPassword(p)) throw new InputError('Password must be at least 8 characters.');
  return bcrypt.hash(p, 12);
};

// Reset tokens: 32 random bytes, URL-safe; only the SHA-256 hash is stored.
export const newResetToken = () => {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
};
export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export async function setPassword(user: UserRow, password: unknown) {
  return store.users.update(user.id, { hash: await hashPassword(password) });
}

let DUMMY_HASH: string | null = null;
export async function verify(username: unknown, password: unknown): Promise<UserRow | null> {
  const user = await findUser(username);
  // Always run a compare so timing doesn't reveal whether the user exists.
  DUMMY_HASH ??= await bcrypt.hash('not-a-real-password', 12);
  const ok = await bcrypt.compare(String(password || ''), user ? user.hash : DUMMY_HASH);
  return ok && user ? user : null;
}

// ---- Effective feedback mode: always exactly one value ----
export function effectiveMode(user: UserRow | null | undefined): FeedbackMode {
  const s = store.settings();
  if (s.allowUserOverride && user && (user.feedbackOverride === 'ai' || user.feedbackOverride === 'selfmark')) return user.feedbackOverride;
  return s.feedbackMode === 'ai' ? 'ai' : 'selfmark';
}

// ---- Middleware ----
// A disabled account counts as logged out, even if it still has a session.
export async function currentUser(req: Request) {
  const u = req.session?.userId ? await findById(req.session.userId) : null;
  return u && u.isActive ? u : null;
}
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: 'Not logged in' }); return; }
  req.user = user;
  next();
}
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: 'Not logged in' }); return; }
  if (user.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return; }
  req.user = user;
  next();
}

export const publicUser = (u: UserRow): PublicUser => ({
  id: u.id, username: u.username, name: u.name, role: u.role, createdAt: u.createdAt, voice: u.voice, feedbackOverride: u.feedbackOverride, email: u.email,
  startDate: u.startDate, examDate: u.examDate, isActive: u.isActive, lastLoginAt: u.lastLoginAt
});

// Where to send someone right after they log in / sign up. Admins manage the site; they don't study.
export const landingFor = (u: UserRow, hasDiagnostic: boolean) =>
  u.role === 'admin' ? '/admin' : !u.startDate ? '/welcome' : hasDiagnostic ? '/dashboard' : '/diagnostic';

export const needsOnboarding = (u: UserRow) => u.role !== 'admin' && !u.startDate;

// Learner-only endpoints (progress, AI marking): admins have no learner data.
export async function requireLearner(req: Request, res: Response, next: NextFunction) {
  const user = req.user ?? await currentUser(req);
  if (!user) { res.status(401).json({ error: 'Not logged in' }); return; }
  if (user.role === 'admin') { res.status(403).json({ error: 'Admin accounts don’t have learner progress. Create a learner account to study.' }); return; }
  req.user = user;
  next();
}

// ---- Generic per-key rate limiter (register, forgot-password) ----
const buckets = new Map<string, number[]>();
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter(t => now - t < windowMs);
  const limited = list.length >= max;
  if (!limited) list.push(now);
  buckets.set(key, list);
  return limited;
}
