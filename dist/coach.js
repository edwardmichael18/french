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
exports.test = exports.feedback = exports.isConfigured = exports.modelFor = exports.keyFor = exports.CoachError = exports.PROVIDERS = void 0;
exports.activeProvider = activeProvider;
exports.describeError = describeError;
// AI coach: scores a piece of writing or a speaking transcript against TCF Canada criteria.
// Provider (Claude / ChatGPT / Gemini) is chosen by the admin; only that one is ever called.
// Only reachable when the effective feedback mode is 'ai' (enforced in server.ts).
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const store = __importStar(require("./store"));
exports.PROVIDERS = {
    claude: { label: 'Claude (Anthropic)', keyField: 'anthropicApiKey', modelField: 'claudeModel', env: 'ANTHROPIC_API_KEY',
        models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] },
    openai: { label: 'ChatGPT (OpenAI)', keyField: 'openaiApiKey', modelField: 'openaiModel', env: 'OPENAI_API_KEY',
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'] },
    gemini: { label: 'Gemini (Google)', keyField: 'geminiApiKey', modelField: 'geminiModel', env: 'GEMINI_API_KEY',
        models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] }
};
const SYSTEM = `You are an expert, honest TCF Canada examiner and French coach for a native English speaker aiming at NCLC 7 (Expression écrite ≥ 10/20, Expression orale ≥ 10/20), roughly low B2.

Score the learner's production the way a TCF Canada rater would, on a 0–20 scale, using these criteria:
- Task fulfilment (did they do what the tâche asked, right register, right length)
- Coherence and cohesion (connectors, organisation, subordination)
- Lexical range and accuracy (nouns with correct gender, precise words, faux amis)
- Grammatical range and accuracy (PC vs imparfait, subjonctif triggers, si-clauses, agreements, pronouns)
- For speaking transcripts also: fluency signals and interaction (questions asked, fillers used, sustaining the turn)

Watch specifically for this learner's known error traps: faux amis (actuellement, éventuellement, sensible, librairie, assister à, passer un examen), avoir vs être for age/hunger/cold, depuis + present, country prepositions (en France, au Canada, au Nigeria, aux États-Unis), savoir vs connaître, bon vs bien / meilleur vs mieux, verb + à/de, gender agreement, conditional or future directly after "si".

Rules:
- Be precise and encouraging but never inflate the score. Point out fossilising mistakes clearly.
- Corrections: quote the exact wrong fragment and give the corrected form plus a rule in five words or fewer.
- Use these trap ids when one applies, else an empty string: fauxamis, avoiretre, depuis, pays, savoir, bonbien, preposition, genre, pcimp, si.
- Give one natural, idiomatic rewrite of the whole piece at a realistic low-B2 level (not C2).
- Explanations in English, examples in French.
- End with ONE short Socratic follow-up question in French that forces the learner to produce again using the thing they got wrong.`;
const SCHEMA = {
    type: 'object',
    properties: {
        score: { type: 'number', description: 'Estimated TCF score out of 20' },
        nclc: { type: 'string', description: 'Estimated NCLC band, e.g. "NCLC 6"' },
        good: { type: 'array', items: { type: 'string' }, description: 'What is working' },
        corrections: {
            type: 'array',
            items: {
                type: 'object',
                properties: { wrote: { type: 'string' }, correction: { type: 'string' }, rule: { type: 'string' }, trap: { type: 'string' } },
                required: ['wrote', 'correction', 'rule', 'trap'],
                additionalProperties: false
            }
        },
        criteria: {
            type: 'object',
            properties: { task: { type: 'string' }, coherence: { type: 'string' }, lexis: { type: 'string' }, grammar: { type: 'string' } },
            required: ['task', 'coherence', 'lexis', 'grammar'],
            additionalProperties: false
        },
        rewrite: { type: 'string' },
        followUp: { type: 'string' }
    },
    required: ['score', 'nclc', 'good', 'corrections', 'criteria', 'rewrite', 'followUp'],
    additionalProperties: false
};
class CoachError extends Error {
    status;
    constructor(message, status = 500) {
        super(message);
        this.status = status;
    }
}
exports.CoachError = CoachError;
function activeProvider() {
    const p = store.settings().aiProvider;
    return exports.PROVIDERS[p] ? p : 'claude';
}
const keyFor = (p) => String(store.settings()[exports.PROVIDERS[p].keyField] || process.env[exports.PROVIDERS[p].env] || '');
exports.keyFor = keyFor;
const modelFor = (p) => String(store.settings()[exports.PROVIDERS[p].modelField] || exports.PROVIDERS[p].models[0]);
exports.modelFor = modelFor;
const isConfigured = () => !!(0, exports.keyFor)(activeProvider());
exports.isConfigured = isConfigured;
function buildUserMessage({ kind, task, prompt, text }) {
    return [
        `Section: ${kind === 'speaking' ? 'Expression orale (transcript of what I said)' : 'Expression écrite'}`,
        `Tâche: ${task || 'free practice'}`,
        prompt ? `Task prompt: ${prompt}` : '',
        '',
        'My attempt:',
        '"""',
        String(text || '').slice(0, 8000),
        '"""'
    ].filter(Boolean).join('\n');
}
function parseJson(text) {
    if (!text)
        throw new CoachError('Empty response from the coach.', 502);
    const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    try {
        return JSON.parse(cleaned);
    }
    catch {
        throw new CoachError('The coach returned an unreadable answer. Try again.', 502);
    }
}
// ---------- Claude (official Anthropic SDK) ----------
async function callClaude(key, model, userMsg, maxTokens) {
    const client = new sdk_1.default({ apiKey: key });
    const base = {
        model,
        max_tokens: maxTokens,
        system: SYSTEM,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: userMsg }]
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let response;
    try {
        // Server-side refusal fallback (Opus 5 / Fable tier). Retried plainly if unsupported.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        response = await client.beta.messages.create({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    }
    catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (err instanceof sdk_1.default.BadRequestError)
            response = await client.messages.create(base);
        else
            throw err;
    }
    if (response.stop_reason === 'refusal')
        throw new CoachError('The coach declined to mark this piece. Try rephrasing or use self-mark.', 422);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const block = response.content.find((b) => b.type === 'text');
    return { data: parseJson(block?.text), model: response.model || model };
}
// ---------- ChatGPT (OpenAI REST) ----------
async function callOpenAI(key, model, userMsg) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg }],
            response_format: { type: 'json_schema', json_schema: { name: 'tcf_feedback', strict: true, schema: SCHEMA } }
        })
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
        throw httpError('OpenAI', res.status, body.error?.message);
    const msg = body.choices?.[0]?.message;
    if (msg?.refusal)
        throw new CoachError('The coach declined to mark this piece.', 422);
    return { data: parseJson(msg?.content), model: body.model || model };
}
// ---------- Gemini (Google REST) ----------
async function callGemini(key, model, userMsg) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM + '\n\nReply with ONLY a JSON object matching this JSON Schema:\n' + JSON.stringify(SCHEMA) }] },
            contents: [{ role: 'user', parts: [{ text: userMsg }] }],
            generationConfig: { responseMimeType: 'application/json' }
        })
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
        throw httpError('Gemini', res.status, body.error?.message);
    const cand = body.candidates?.[0];
    if (!cand?.content)
        throw new CoachError('Gemini returned no answer (possibly blocked by its safety filter).', 422);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (cand.content.parts || []).map((p) => p.text || '').join('');
    return { data: parseJson(text), model };
}
function httpError(name, status, message) {
    if (status === 401 || status === 403 || (status === 400 && /api key/i.test(message || '')))
        return new CoachError(`${name} rejected the API key. Check it in Admin → AI coach.`, 400);
    if (status === 404)
        return new CoachError(`${name}: model not found. Pick another model in Admin → AI coach.`, 400);
    if (status === 429)
        return new CoachError(`${name} rate limit or quota reached. Wait and retry, or check billing.`, 429);
    return new CoachError(`${name} error (${status}): ${message || 'unknown'}`, 502);
}
async function run(userMsg, maxTokens = 16000) {
    const provider = activeProvider();
    const key = (0, exports.keyFor)(provider);
    if (!key)
        throw new CoachError(`No API key set for ${exports.PROVIDERS[provider].label}. Ask the admin to add one in Admin → AI coach.`, 400);
    const model = (0, exports.modelFor)(provider);
    const out = provider === 'openai' ? await callOpenAI(key, model, userMsg)
        : provider === 'gemini' ? await callGemini(key, model, userMsg)
            : await callClaude(key, model, userMsg, maxTokens);
    return { ...out.data, provider: exports.PROVIDERS[provider].label, model: out.model };
}
const feedback = (input) => run(buildUserMessage(input));
exports.feedback = feedback;
// Admin "Test connection": marks one tiny sentence end to end.
const test = () => run(buildUserMessage({ kind: 'writing', task: 'test', text: "J'ai 32 ans et j'habite à Lagos depuis cinq ans." }), 4000);
exports.test = test;
function describeError(err) {
    if (err instanceof CoachError)
        return { status: err.status, message: err.message };
    if (err instanceof sdk_1.default.AuthenticationError)
        return { status: 400, message: 'Claude rejected the API key. Check it in Admin → AI coach.' };
    if (err instanceof sdk_1.default.RateLimitError)
        return { status: 429, message: 'Rate limited by the Claude API. Wait a minute and retry.' };
    if (err instanceof sdk_1.default.NotFoundError)
        return { status: 400, message: 'Claude model not found. Pick another model in Admin → AI coach.' };
    if (err instanceof sdk_1.default.APIConnectionError)
        return { status: 502, message: 'Could not reach the Claude API. Check your internet connection.' };
    if (err instanceof sdk_1.default.APIError)
        return { status: 502, message: `Claude API error (${err.status}): ${err.message}` };
    if (err instanceof TypeError && /fetch/i.test(err.message))
        return { status: 502, message: 'Could not reach the AI provider. Check your internet connection.' };
    return { status: 500, message: err instanceof Error ? err.message : 'Unknown error' };
}
//# sourceMappingURL=coach.js.map