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
exports.isMailConfigured = isMailConfigured;
exports.send = send;
exports.resetEmail = resetEmail;
// Outgoing email over SMTP, configured in Admin → Email (password reset links).
const nodemailer_1 = __importDefault(require("nodemailer"));
const store = __importStar(require("./store"));
function isMailConfigured() {
    const s = store.settings();
    return !!(s.smtpHost && s.smtpFrom);
}
function transport() {
    const s = store.settings();
    return nodemailer_1.default.createTransport({
        host: s.smtpHost,
        port: s.smtpPort || 587,
        secure: !!s.smtpSecure, // true for 465; false = STARTTLS on 587
        auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPass } : undefined,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000
    });
}
async function send(to, subject, text, html) {
    if (!isMailConfigured())
        throw new Error('Email is not configured. Set SMTP in Admin → Email.');
    await transport().sendMail({ from: store.settings().smtpFrom, to, subject, text, html });
}
const esc = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function resetEmail(name, link, minutes) {
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
//# sourceMappingURL=mail.js.map