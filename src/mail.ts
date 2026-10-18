// Outgoing email over SMTP, configured in Admin → Email (password reset links).
import nodemailer from 'nodemailer';
import * as store from './store';

export function isMailConfigured(): boolean {
  const s = store.settings();
  return !!(s.smtpHost && s.smtpFrom);
}

function transport() {
  const s = store.settings();
  return nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort || 587,
    secure: !!s.smtpSecure, // true for 465; false = STARTTLS on 587
    auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000
  });
}

export async function send(to: string, subject: string, text: string, html: string) {
  if (!isMailConfigured()) throw new Error('Email is not configured. Set SMTP in Admin → Email.');
  await transport().sendMail({ from: store.settings().smtpFrom, to, subject, text, html });
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function resetEmail(name: string, link: string, minutes: number) {
  const text = [
    `Bonjour ${name},`,
    '',
    'Someone asked to reset your French Academy password. If it was you, open this link to choose a new one:',
    link,
    '',
    `The link works once and expires in ${minutes} minutes.`,
    "If you didn't ask for this, ignore this email — your password stays the same.",
    '',
    '— French Academy'
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f3ec;font-family:system-ui,sans-serif;color:#1c2230">
<div style="max-width:480px;margin:auto;background:#fff;border:1px solid #ddd6c8;border-radius:14px;padding:24px">
<h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 12px">Reset your password</h1>
<p>Bonjour ${esc(name)},</p>
<p>Someone asked to reset your French Academy password. If it was you, choose a new one:</p>
<p style="margin:20px 0"><a href="${esc(link)}" style="background:#1f3a8a;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">Choose a new password</a></p>
<p style="font-size:13px;color:#4a5263">The link works once and expires in ${minutes} minutes. If you didn't ask for this, ignore this email — your password stays the same.</p>
<p style="font-size:12px;color:#7a8191;word-break:break-all">${esc(link)}</p>
</div></body></html>`;
  return { subject: 'Reset your French Academy password', text, html };
}
