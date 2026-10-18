// AI coach: scores a piece of writing or a speaking transcript against TCF Canada criteria.
// Provider (Claude / ChatGPT / Gemini) is chosen by the admin; only that one is ever called.
// Only reachable when the effective feedback mode is 'ai' (enforced in server.ts).
import Anthropic from '@anthropic-ai/sdk';
import type { FeedbackRequest, FeedbackResult, ProviderId } from '@fa/shared';
import * as store from './store';
import type { Settings } from './store';

interface ProviderDef { label: string; keyField: keyof Settings; modelField: keyof Settings; env: string; models: string[] }
export const PROVIDERS: Record<ProviderId, ProviderDef> = {
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
} as const;

export class CoachError extends Error {
  constructor(message: string, public status = 500) { super(message); }
}

export function activeProvider(): ProviderId {
  const p = store.settings().aiProvider;
  return PROVIDERS[p] ? p : 'claude';
}
export const keyFor = (p: ProviderId) => String(store.settings()[PROVIDERS[p].keyField] || process.env[PROVIDERS[p].env] || '');
export const modelFor = (p: ProviderId) => String(store.settings()[PROVIDERS[p].modelField] || PROVIDERS[p].models[0]);
export const isConfigured = () => !!keyFor(activeProvider());

function buildUserMessage({ kind, task, prompt, text }: FeedbackRequest) {
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

function parseJson(text: string | undefined): FeedbackResult {
  if (!text) throw new CoachError('Empty response from the coach.', 502);
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(cleaned); } catch { throw new CoachError('The coach returned an unreadable answer. Try again.', 502); }
}

// ---------- Claude (official Anthropic SDK) ----------
async function callClaude(key: string, model: string, userMsg: string, maxTokens: number) {
  const client = new Anthropic({ apiKey: key });
  const base = {
    model,
    max_tokens: maxTokens,
    system: SYSTEM,
    output_config: { format: { type: 'json_schema' as const, schema: SCHEMA } },
    messages: [{ role: 'user' as const, content: userMsg }]
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let response: any;
  try {
    // Server-side refusal fallback (Opus 5 / Fable tier). Retried plainly if unsupported.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response = await client.beta.messages.create({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as any);
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (err instanceof Anthropic.BadRequestError) response = await client.messages.create(base as any);
    else throw err;
  }
  if (response.stop_reason === 'refusal') throw new CoachError('The coach declined to mark this piece. Try rephrasing or use self-mark.', 422);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const block = response.content.find((b: any) => b.type === 'text');
  return { data: parseJson(block?.text), model: response.model || model };
}

// ---------- ChatGPT (OpenAI REST) ----------
async function callOpenAI(key: string, model: string, userMsg: string) {
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
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError('OpenAI', res.status, body.error?.message);
  const msg = body.choices?.[0]?.message;
  if (msg?.refusal) throw new CoachError('The coach declined to mark this piece.', 422);
  return { data: parseJson(msg?.content), model: body.model || model };
}

// ---------- Gemini (Google REST) ----------
async function callGemini(key: string, model: string, userMsg: string) {
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
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError('Gemini', res.status, body.error?.message);
  const cand = body.candidates?.[0];
  if (!cand?.content) throw new CoachError('Gemini returned no answer (possibly blocked by its safety filter).', 422);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (cand.content.parts || []).map((p: any) => p.text || '').join('');
  return { data: parseJson(text), model };
}

function httpError(name: string, status: number, message?: string) {
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(message || ''))) return new CoachError(`${name} rejected the API key. Check it in Admin → AI coach.`, 400);
  if (status === 404) return new CoachError(`${name}: model not found. Pick another model in Admin → AI coach.`, 400);
  if (status === 429) return new CoachError(`${name} rate limit or quota reached. Wait and retry, or check billing.`, 429);
  return new CoachError(`${name} error (${status}): ${message || 'unknown'}`, 502);
}

async function run(userMsg: string, maxTokens = 16000): Promise<FeedbackResult> {
  const provider = activeProvider();
  const key = keyFor(provider);
  if (!key) throw new CoachError(`No API key set for ${PROVIDERS[provider].label}. Ask the admin to add one in Admin → AI coach.`, 400);
  const model = modelFor(provider);
  const out = provider === 'openai' ? await callOpenAI(key, model, userMsg)
    : provider === 'gemini' ? await callGemini(key, model, userMsg)
      : await callClaude(key, model, userMsg, maxTokens);
  return { ...out.data, provider: PROVIDERS[provider].label, model: out.model };
}

export const feedback = (input: FeedbackRequest) => run(buildUserMessage(input));

// Admin "Test connection": marks one tiny sentence end to end.
export const test = () => run(buildUserMessage({ kind: 'writing', task: 'test', text: "J'ai 32 ans et j'habite à Lagos depuis cinq ans." }), 4000);

export function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof CoachError) return { status: err.status, message: err.message };
  if (err instanceof Anthropic.AuthenticationError) return { status: 400, message: 'Claude rejected the API key. Check it in Admin → AI coach.' };
  if (err instanceof Anthropic.RateLimitError) return { status: 429, message: 'Rate limited by the Claude API. Wait a minute and retry.' };
  if (err instanceof Anthropic.NotFoundError) return { status: 400, message: 'Claude model not found. Pick another model in Admin → AI coach.' };
  if (err instanceof Anthropic.APIConnectionError) return { status: 502, message: 'Could not reach the Claude API. Check your internet connection.' };
  if (err instanceof Anthropic.APIError) return { status: 502, message: `Claude API error (${err.status}): ${err.message}` };
  if (err instanceof TypeError && /fetch/i.test(err.message)) return { status: 502, message: 'Could not reach the AI provider. Check your internet connection.' };
  return { status: 500, message: err instanceof Error ? err.message : 'Unknown error' };
}
