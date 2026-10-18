// Validates every content file: JSON parses, quiz items are well-formed, week/test references resolve.
const fs = require('fs');
const path = require('path');
const C = path.join(__dirname, '..', 'content');
let errors = 0;
const bad = (f, msg) => { errors++; console.error(`✘ ${f}: ${msg}`); };
const read = f => { try { return JSON.parse(fs.readFileSync(path.join(C, f), 'utf8')); } catch (e) { bad(f, e.message); return null; } };

function checkItem(f, it, where) {
  const t = it.type || 'mcq';
  if (t === 'mcq' || t === 'listen') {
    if (!Array.isArray(it.options) || it.options.length < 2) return bad(f, `${where}: needs ≥2 options`);
    if (!(it.answer >= 0 && it.answer < it.options.length)) bad(f, `${where}: answer index out of range`);
    if (t === 'listen' && !it.say) bad(f, `${where}: listen item without "say"`);
  } else if (t === 'gap') {
    if (!it.answer || ![].concat(it.answer).length) bad(f, `${where}: gap without answer`);
  } else if (t === 'produce') {
    if (!it.model) bad(f, `${where}: produce without model`);
  } else bad(f, `${where}: unknown type ${t}`);
}

const res = read('resources.json');
const resIds = new Set(res ? res.sections.flatMap(s => s.items.map(i => i.id)).concat(res.videos.map(v => v.rid).filter(Boolean)) : []);
for (let w = 1; w <= 21; w++) {
  const f = `weeks/${w}.json`, wk = read(f);
  if (!wk) continue;
  if (wk.w !== w) bad(f, 'w mismatch');
  (wk.resources || []).forEach(r => { if (!resIds.has(r)) bad(f, `unknown resource id "${r}"`); });
  wk.steps.forEach((s, i) => {
    if (s.kind === 'check') checkItem(f, s, `step ${i}`);
    if (s.kind === 'drill' || s.kind === 'spiral') s.items.forEach((it, j) => checkItem(f, it, `step ${i} item ${j}`));
    if (s.kind === 'produce' && !['speak', 'write'].includes(s.mode)) bad(f, `step ${i}: produce needs mode speak|write`);
  });
}
for (const f of ['levels.json', 'traps.json', 'themes.json', 'phonetics.json', 'schedule.json', 'checklist.json']) {
  const d = read(f);
  if (!d) continue;
  if (f === 'levels.json') d.levels.forEach(l => l.drill.forEach((it, j) => checkItem(f, it, `${l.id} ${j}`)));
  if (f === 'traps.json') d.traps.forEach(t => t.items.forEach((it, j) => checkItem(f, it, `${t.id} ${j}`)));
  if (f === 'themes.json') d.themes.forEach(t => { if (t.nouns.length !== 10 || t.verbs.length !== 5 || t.expr.length !== 3 || t.pro.length !== 2 || t.con.length !== 2) bad(f, `${t.id}: protocol counts off`); });
  if (f === 'schedule.json' && d.weeks.length !== 21) bad(f, 'needs 21 weeks');
}
const basics = read('basics.json');
if (basics) {
  const ids = new Set();
  for (const s of basics.sections) {
    if (ids.has(s.id)) bad('basics.json', `duplicate section ${s.id}`);
    ids.add(s.id);
    if (!['letters', 'words', 'numbers'].includes(s.quiz)) bad('basics.json', `${s.id}: quiz must be letters|words|numbers`);
    const items = [...(s.items || []), ...(s.groups || []).flatMap(g => g.items)];
    if (items.length < 4) bad('basics.json', `${s.id}: needs at least 4 items for practice`);
    items.forEach((it, j) => {
      if (!it.fr) bad('basics.json', `${s.id} item ${j}: missing "fr"`);
      if (it.g && !['m', 'f'].includes(it.g)) bad('basics.json', `${s.id} "${it.fr}": g must be m or f`);
      if (it.fem && !it.fr.includes(' / ')) bad('basics.json', `${s.id} "${it.fr}": a pair (fem) is written "masc / fem"`);
      // l'/les nouns hide their gender — the gender badge and "Le or la?" drill need it spelled out.
      if (/^(l'\p{L}|les )/u.test(it.fr) && !it.g && !it.fr.includes(' / ')) bad('basics.json', `${s.id} "${it.fr}": add g (m/f)`);
    });
  }
  if (!ids.has('words')) bad('basics.json', 'a "words" section is required (used for spelling dictation)');
}

const idx = read('tests/index.json') || [];
for (const t of idx) {
  const d = read(`tests/${t.id}.json`);
  if (!d) continue;
  d.sections.filter(s => s.type === 'mcq' || s.type === 'drill').forEach(s => s.items.forEach((it, j) => {
    checkItem(`tests/${t.id}.json`, it, `${s.id} ${j}`);
    // Mock/gate CO & CE items are reviewed after submit — each needs its explanation (scripts/explain-*.js).
    if (s.type === 'mcq' && !it.explain) bad(`tests/${t.id}.json`, `${s.id} ${j}: missing explain`);
  }));
}

// ---------- The four skills ----------
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const words = s => (String(s).trim().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
const videoIds = new Set(res ? res.videos.map(v => v.id) : []);
const itemIds = new Set(res ? res.sections.flatMap(s => s.items.map(i => i.id)) : []);
for (const id of ['co', 'ce', 'ee', 'eo']) {
  const f = `skills/${id}.json`, g = read(f);
  if (!g) continue;
  if (g.id !== id) bad(f, 'id mismatch');
  for (const k of ['title', 'fr', 'icon', 'summary']) if (!g[k]) bad(f, `missing ${k}`);
  if (!g.facts?.length || !g.format?.length || !g.checklist?.length || !g.mistakes?.length) bad(f, 'facts, format, checklist and mistakes must be non-empty');
  if (!g.lessons?.length) bad(f, 'needs lessons');
  const lids = new Set();
  (g.lessons || []).forEach(l => {
    if (lids.has(l.id)) bad(f, `duplicate lesson ${l.id}`);
    lids.add(l.id);
    if (!l.steps.some(s => s.kind === 'check')) bad(f, `${l.id}: a tutorial needs at least one check`);
    if (l.steps[l.steps.length - 1]?.kind !== 'recap') bad(f, `${l.id}: should end with a recap`);
    l.steps.forEach((s, i) => {
      if (s.kind === 'check') checkItem(f, s, `${l.id} step ${i}`);
      if (s.kind === 'drill' || s.kind === 'spiral') s.items.forEach((it, j) => checkItem(f, it, `${l.id} step ${i} item ${j}`));
    });
  });
  g.resources.forEach(r => { if (!itemIds.has(r)) bad(f, `unknown resource "${r}"`); });
  g.videos.forEach(v => { if (!videoIds.has(v)) bad(f, `video ${v} is not in resources.json videos (verify it, then add it there)`); });
  Object.keys(g.levelLinks || {}).forEach(l => { if (!LEVELS.includes(l)) bad(f, `levelLinks: bad level ${l}`); });
}

for (const id of ['co', 'ce']) {
  const f = `skills/drill-${id}.json`, d = read(f);
  if (!d) continue;
  const per = {};
  d.items.forEach((it, j) => {
    checkItem(f, it, `item ${j}`);
    if (!it.explain) bad(f, `item ${j}: missing explain`);
    if (!LEVELS.includes(it.level)) bad(f, `item ${j}: bad level`);
    if (!d.docs[it.doc]) bad(f, `item ${j}: unknown doc "${it.doc}"`);
    if (it.options.length !== 4) bad(f, `item ${j}: TCF items have 4 options`);
    if (id === 'co' ? !it.say : !it.context) bad(f, `item ${j}: missing ${id === 'co' ? 'say' : 'context'}`);
    per[it.level] = (per[it.level] || 0) + 1;
  });
  LEVELS.forEach(l => { if ((per[l] || 0) < 5) bad(f, `only ${per[l] || 0} ${l} items (need 5+)`); });
}

// Word ranges come from the plan: T1 60–120 · T2 120–150 · T3 120–180 (40–60 summary + 80–120 opinion).
const EE_RANGE = { EE1: [60, 120], EE2: [120, 150], EE3: [120, 180] };
for (const f of ['skills/ee-tasks.json', 'skills/eo-tasks.json']) {
  const d = read(f);
  if (!d) continue;
  d.tasks.forEach(t => {
    if (!t.prompts?.length) bad(f, `${t.id}: no prompts`);
    if (t.video && !videoIds.has(t.video)) bad(f, `${t.id}: unknown video ${t.video}`);
    const range = EE_RANGE[t.id];
    if (range && (t.min !== range[0] || t.max !== range[1])) bad(f, `${t.id}: word range must be ${range.join('–')}`);
    t.prompts.forEach((p, j) => {
      if (!p.prompt || !p.model || !p.theme) bad(f, `${t.id} prompt ${j}: needs theme, prompt and model`);
      if (range) {
        const n = words(p.model);
        if (n < range[0] || n > range[1]) bad(f, `${t.id} prompt ${j}: model is ${n} words (range ${range.join('–')})`);
      }
      if (t.id === 'EE3') { // line 0 = title, line 1 = part 1, rest = part 2
        const lines = p.model.split('\n'), p1 = words(lines[1] || ''), p2 = words(lines.slice(2).join(' '));
        if (p1 < 40 || p1 > 60 || p2 < 80 || p2 > 120) bad(f, `EE3 prompt ${j}: parts are ${p1} + ${p2} words (need 40–60 + 80–120)`);
      }
    });
  });
}

// Drills and tutorials must not reuse mock material (keeps mock scores honest): flag 3+ shared 6-word runs.
{
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const runs = t => { const w = norm(t).split(' '), s = new Set(); for (let i = 0; i + 6 <= w.length; i++) s.add(w.slice(i, i + 6).join(' ')); return s; };
  const mocks = [];
  for (const b of ['a', 'b', 'c']) { const B = require('./bank-' + b); for (const k of ['co', 'ce']) B[k].forEach((r, i) => mocks.push({ id: `mock ${b.toUpperCase()} ${k} ${i + 1}`, runs: runs(r[1]) })); }
  const reused = t => { const r = runs(t); for (const m of mocks) { let c = 0; for (const x of r) if (m.runs.has(x)) c++; if (c >= 3 || (c && c / Math.min(r.size, m.runs.size || 1) >= 0.4)) return m.id; } return null; };
  for (const id of ['co', 'ce']) {
    const d = read(`skills/drill-${id}.json`);
    (d?.items || []).forEach((it, j) => { const m = reused(it.say || it.context); if (m) bad(`skills/drill-${id}.json`, `item ${j} reuses ${m}`); });
  }
  for (const id of ['co', 'ce', 'ee', 'eo']) {
    const g = read(`skills/${id}.json`);
    (g?.lessons || []).forEach(l => l.steps.forEach((s, i) => ['say', 'context', 'q', 'body'].forEach(k => { const m = s[k] && reused(s[k]); if (m) bad(`skills/${id}.json`, `${l.id} step ${i} reuses ${m}`); })));
  }
}
console.log(errors ? `\n${errors} problem(s).` : '✔ All content valid.');
process.exit(errors ? 1 : 0);
