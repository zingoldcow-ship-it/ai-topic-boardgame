
(() => {
  'use strict';

  const MODE = document.body?.dataset?.mode || 'student'; // teacher | student
  const STORAGE = {
    geminiKey: 'GEMINI_API_KEY',
    aiConfig: 'TOPIC_BOARDGAME_AI_CONFIG_V2',
    savedPack: 'TOPIC_BOARDGAME_PACK_V2',
  };

  const DEFAULTS = {
    model: 'gemini-2.0-flash',
    deckCount: 30,
    qMode: 'mcq',
    showAnswer: true,
    activityMinutes: 7,
    gameSeconds: 420,
    cols: 10,
    rows: 6,
  };

  // ---------- sound (WebAudio, no external files) ----------
  let audioCtx = null;
  function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
    return audioCtx;
  }
  function tone({freq=440, type='sine', duration=0.12, gain=0.12, when=0}={}){
    const ctx = getAudio();
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }
  function playDiceSound(){
    // quick rattling effect
    for (let i=0;i<10;i++) {
      const f = 220 + Math.random()*520;
      tone({freq:f, type:'square', duration:0.06, gain:0.06, when:i*0.08});
    }
  }
  function playCorrectSound(){
    tone({freq:523.25, type:'sine', duration:0.10, gain:0.12, when:0});
    tone({freq:659.25, type:'sine', duration:0.12, gain:0.12, when:0.10});
    tone({freq:783.99, type:'sine', duration:0.14, gain:0.12, when:0.20});
  }
  function playWrongSound(){
    tone({freq:220, type:'sawtooth', duration:0.18, gain:0.10, when:0});
    tone({freq:165, type:'sawtooth', duration:0.22, gain:0.10, when:0.12});
  }


  const $ = (id) => document.getElementById(id);

  const els = {
    // header / settings
    settingsBtn: $('openSettings'),

    // teacher controls
    topicInput: $('topicInput'),
    applyTopic: $('applyTopic'),
    setupHint: $('setupHint'),
    openSettingsInline: $('openSettingsInline'),

    // common controls
    startGame: $('startGame'),
    resetGame: $('resetGame'),
    rollBtn: $('rollBtn'),
    dice: $('dice'),
    diceResult: $('diceResult'),
    scoreP1: $('scoreP1'),
    scoreP2: $('scoreP2'),
    timer: $('timer'),
    log: $('log'),
    board: $('board'),
    modeBadge: $('modeBadge'),

    // pack file
    exportPack: $('exportPack'),
    importPack: $('importPack'),
    importPackInput: $('importPackInput'),

    // modals
    qModal: $('qModal'),
    qTitle: $('qTitle'),
    qText: $('qText'),
    choiceWrap: $('choiceWrap'),
    aInput: $('aInput'),
    aSubmit: $('aSubmit'),
    aClose: $('aClose'),

    resultModal: $('resultModal'),
    resultText: $('resultText'),
    resultClose: $('resultClose'),
    resultCopy: $('resultCopy'),
    resultDownload: $('resultDownload'),

    // settings drawer (teacher only)
    drawer: $('drawer'),
    closeSettings: $('closeSettings'),
    apiKeyInput: $('apiKeyInput'),
    saveKey: $('saveKey'),
    deleteKey: $('deleteKey'),
    getKeyBtn: $('getKeyBtn'),
    modelSel: $('geminiModel'),
    qMode: $('qMode'),
    showAnswer: $('showAnswer'),
    deckCount: $('deckCount'),
    activityMinutes: $('activityMinutes'),
    testAi: $('testAi'),
    saveAi: $('saveAi'),
  };

  // remove teacher-only blocks on student
  if (MODE !== 'teacher') {
    document.querySelectorAll('[data-teacher-only]').forEach((el) => el.remove());
    if (els.settingsBtn) els.settingsBtn.remove();
  }

  // ---------- utils ----------
  const clamp = (n, a, b) => Math.min(Math.max(n, a), b);

  function escapeRegExp(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function normalizeForMatch(s){
    return String(s || '')
      .toLowerCase()
      .replace(/\s+/g,'')
      .replace(/[“”"'\u2019\u2018]/g,'')
      .replace(/[.,!?，。]/g,'');
  }

  function extractAnswerToken(explain){
    const t = String(explain || '').trim();
    // e.g., "정답: 3/10", "답은 16입니다"
    const m = t.match(/(?:정답|답)\s*[:：]?\s*([^\s,。\.\n]+)/);
    return m ? m[1].trim() : '';
  }

  function inferAnswerIndexFromExplain(explain, choices){
    if (!explain || !Array.isArray(choices)) return -1;
    const ex = String(explain);
    const token = extractAnswerToken(ex);
    if (token) {
      const ti = normalizeForMatch(token);
      for (let i=0;i<choices.length;i++){
        if (normalizeForMatch(choices[i]) === ti) return i;
      }
    }

    // direct mention search (prefer exact tokens / fractions / decimals)
    const exNorm = normalizeForMatch(ex);
    const hits = [];
    for (let i=0;i<choices.length;i++){
      const c = String(choices[i] ?? '');
      const cTrim = c.trim();
      if (!cTrim) continue;

      // Use boundary-aware regex on raw explain where possible (avoid "1" matching "10")
      const escaped = escapeRegExp(cTrim);
      const re = new RegExp(`(^|[^0-9A-Za-z가-힣])${escaped}([^0-9A-Za-z가-힣]|$)`);
      if (re.test(ex)) { hits.push(i); continue; }

      // fallback to normalized substring (handles minor spacing)
      const cNorm = normalizeForMatch(cTrim);
      if (cNorm && exNorm.includes(cNorm) && cNorm.length >= 2) hits.push(i);
    }
    if (hits.length === 1) return hits[0];

    return -1;
  }

  function fixAnswerIndexByExplain(q){
    if (!q || q.kind !== 'mcq') return q;
    if (!Array.isArray(q.choices) || q.choices.length !== 4) return q;
    const inferred = inferAnswerIndexFromExplain(q.explain, q.choices);
    if (inferred >= 0 && inferred <= 3) q.answerIndex = inferred;
    return q;
  }


function safeJsonParse(text) {
  if (!text) return null;
  let t = String(text).trim();

  // 1) ```json ... ``` code fence extract
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) t = fence[1].trim();

  // 2) direct parse
  try { return JSON.parse(t); } catch {}

  // 3) slice array part
  const a0 = t.indexOf('[');
  const a1 = t.lastIndexOf(']');
  if (a0 !== -1 && a1 !== -1 && a1 > a0) {
    try { return JSON.parse(t.slice(a0, a1 + 1)); } catch {}
  }

  // 4) slice object part
  const o0 = t.indexOf('{');
  const o1 = t.lastIndexOf('}');
  if (o0 !== -1 && o1 !== -1 && o1 > o0) {
    try { return JSON.parse(t.slice(o0, o1 + 1)); } catch {}
  }

  return null;
}

// Extract top-level JSON objects from a text (tolerates missing outer array)
function extractObjectsFromText(text) {
  if (!text) return null;
  const t = String(text);
  const out = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;

  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = false; }
      continue;
    } else {
      if (ch === '"') { inStr = true; continue; }
    }

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) depth--;
      if (depth === 0 && start !== -1) {
        const chunk = t.slice(start, i + 1).trim();
        start = -1;
        try {
          const obj = JSON.parse(chunk);
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) out.push(obj);
        } catch {
          // ignore malformed chunk
        }
      }
    }
  }

  return out.length ? out : null;
}

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }


  function nowStamp() {
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function downloadText(filename, content, mime='application/json') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function fmtTime(sec) {
    const m = Math.floor(sec/60);
    const s = sec % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function logLine(msg) {
    if (!els.log) return;
    const div = document.createElement('div');
    div.textContent = msg;
    els.log.appendChild(div);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function getSavedKey() { return localStorage.getItem(STORAGE.geminiKey) || ''; }
  function setSavedKey(v) { localStorage.setItem(STORAGE.geminiKey, v); }
  function clearSavedKey() { localStorage.removeItem(STORAGE.geminiKey); }

  function getAiConfig() {
    const raw = localStorage.getItem(STORAGE.aiConfig);
    const cfg = raw ? safeJsonParse(raw) : null;
    return {
      model: cfg?.model || DEFAULTS.model,
      qMode: cfg?.qMode || DEFAULTS.qMode,
      showAnswer: (typeof cfg?.showAnswer === 'boolean') ? cfg.showAnswer : DEFAULTS.showAnswer,
      deckCount: Number.isFinite(cfg?.deckCount) ? cfg.deckCount : DEFAULTS.deckCount,
      activityMinutes: Number.isFinite(cfg?.activityMinutes) ? cfg.activityMinutes : DEFAULTS.activityMinutes,
    };
  }
  function setAiConfig(cfg) { localStorage.setItem(STORAGE.aiConfig, JSON.stringify(cfg)); }


  function getConfiguredMinutes() {
    // priority: pack(학생용 배포용) → 저장된 설정(교사용) → 기본값
    const p = state.pack?.settings?.activityMinutes;
    const cfg = getAiConfig();
    const m0 = Number.isFinite(p) ? p : (Number.isFinite(cfg?.activityMinutes) ? cfg.activityMinutes : DEFAULTS.activityMinutes);
    return clamp(Number(m0), 1, 180);
  }
  function getConfiguredGameSeconds() { return getConfiguredMinutes() * 60; }

  function refreshSetupHint() {
    if (MODE !== 'teacher') return;
    if (!els.setupHint) return;
    const hasKey = !!getSavedKey().trim();
    els.setupHint.style.display = hasKey ? 'none' : 'block';
  }


  function saveLastPack(pack) { localStorage.setItem(STORAGE.savedPack, JSON.stringify(pack)); }
  function loadLastPack() {
    const raw = localStorage.getItem(STORAGE.savedPack);
    return raw ? safeJsonParse(raw) : null;
  }

  // ---------- board geometry ----------
  const ROWS = DEFAULTS.rows;
  const COLS = DEFAULTS.cols;

  function buildGrid() {
    const grid = {};
    els.board.innerHTML = '';
    els.board.style.setProperty('--rows', ROWS);
    els.board.style.setProperty('--cols', COLS);
    for (let r=0; r<ROWS; r++) {
      for (let c=0; c<COLS; c++) {
        const el = document.createElement('div');
        el.className = 'cell empty';
        el.dataset.r = r;
        el.dataset.c = c;
        els.board.appendChild(el);
        grid[`${r}-${c}`] = el;
      }
    }
    return grid;
  }

  function buildPerimeterPath() {
    const path = [];
    for (let c=0; c<COLS; c++) path.push([0,c]);
    for (let r=1; r<ROWS; r++) path.push([r, COLS-1]);
    for (let c=COLS-2; c>=0; c--) path.push([ROWS-1, c]);
    for (let r=ROWS-2; r>=1; r--) path.push([r, 0]);
    return path;
  }

  const ACTION = (label, action, value=0) => ({ kind:'action', label, action, value });
  const QUIZ = (label, qtype) => ({ kind:'quiz', label, qtype });

  function baseLayout(total) {
    const arr = Array.from({length: total}, () => null);
    arr[0] = { kind:'start', label:'시작!!' };
    arr[Math.floor(total*0.35)] = ACTION('한 번 쉬기','skip',1);
    arr[Math.floor(total*0.55)] = ACTION('두 칸 앞으로','move', 2);
    arr[Math.floor(total*0.72)] = ACTION('두 칸 뒤로','move',-2);
    arr[Math.floor(total*0.88)] = ACTION('한 번 쉬기','skip',1);

    const quizLabels = [
      ['핵심','core'], ['정의','def'], ['OX','ox'],
      ['예시','example'], ['비교','compare'], ['이유','reason'],
    ];
    let qi = 0;
    for (let i=0; i<total; i++) {
      if (arr[i]) continue;
      const [lab, qt] = quizLabels[qi % quizLabels.length];
      qi++;
      arr[i] = QUIZ(lab, qt);
    }
    // number quiz tiles (핵심1 ...)
    let n = 1;
    for (let i=0; i<total; i++) if (arr[i].kind === 'quiz') arr[i]._n = n++;
    return arr;
  }

  function renderTiles(grid, path, cells) {
    Object.values(grid).forEach(el => { el.className = 'cell empty'; el.innerHTML=''; });
    for (let i=0; i<path.length; i++) {
      const [r,c] = path[i];
      const el = grid[`${r}-${c}`];
      const cell = cells[i];
      el.className = 'cell tile';
      if (cell.kind === 'start') el.classList.add('start');
      if (cell.kind === 'action') el.classList.add('action');
      if (cell.kind === 'quiz') el.classList.add('quiz');

      const badge = (cell.kind === 'quiz') ? `${cell.label}${cell._n}` : cell.label;
      // start tile uses custom markup (start!! + arrow)
      if (cell.kind === 'start') {
        el.innerHTML = `<span class="tile-label startBadge"><span class="tile-text">시작!!</span>`+
          `<svg class="arrowSvg" viewBox="0 0 60 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`+
          `<path d="M2 10 H48" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>`+
          `<path d="M44 4 L58 10 L44 16" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`+
          `</svg></span>`;
        continue;
      }
                  const iconClass = (() => {
        // Action tiles
        if (cell.kind === 'action' && cell.action === 'skip') return 'tile-symbol sym-moon';
        if (cell.kind === 'action' && cell.value > 0) return 'tile-symbol sym-gift';
        if (cell.kind === 'action' && cell.value < 0) return 'tile-symbol sym-leaf';

        // OX tiles
        if (cell.kind === 'quiz' && cell.qtype === 'ox') return 'tile-symbol sym-diamond';

        // Default quiz: rotate a few friendly symbols to add variety
        const pool = ['tile-symbol sym-star', 'tile-symbol sym-cloud', 'tile-symbol sym-leaf', 'tile-symbol sym-gift'];
        return pool[i % pool.length];
      })();

      const iconChar = (() => {
        if (iconClass.includes('sym-moon')) return '🌙';
        if (iconClass.includes('sym-gift')) return '🎁';
        if (iconClass.includes('sym-leaf')) return '🍀';
        if (iconClass.includes('sym-cloud')) return '☁️';
        if (iconClass.includes('sym-diamond')) return '◆';
        return '⭐';
      })();

      el.innerHTML = `<span class="tile-label"><span class="${iconClass}" aria-hidden="true">${iconChar}</span><span class="tile-text">${badge}</span></span>`;
skip: [0,0],
    remaining: DEFAULTS.gameSeconds,
    timerId: null,

    pack: null,       // {version, topic, createdAt, model, settings, deck:[]}
    deckQueues: { mcq: [], ox: [] },
    deckPos: { mcq: 0, ox: 0 },
    currentQuestion: null,
  };

  function setModeBadge() {
    if (els.modeBadge) els.modeBadge.textContent = (MODE === 'teacher') ? '교사용' : '학생용';
  }
  setModeBadge();

  function setScores() {
    if (els.scoreP1) els.scoreP1.textContent = state.score[0];
    if (els.scoreP2) els.scoreP2.textContent = state.score[1];
  }
  function setTimer() {
    if (els.timer) els.timer.textContent = fmtTime(state.remaining);
  }

  function clearTokens() { document.querySelectorAll('.token').forEach(el => el.remove()); }
  function drawTokens() {
    clearTokens();
    for (let p=0; p<2; p++) {
      const idx = state.pos[p];
      const [r,c] = path[idx];
      const el = grid[`${r}-${c}`];
      const t = document.createElement('span');
      t.className = `token ${p===0?'red':'blue'}`;
      el.appendChild(t);
    }
  }
  setScores(); setTimer(); drawTokens();

  // ---------- pack import/export ----------
  function validatePack(pack) {
    if (!pack || typeof pack !== 'object') return {ok:false, msg:'파일 형식이 올바르지 않습니다.'};
    if (!pack.topic) return {ok:false, msg:'주제(topic)가 없습니다.'};
    if (!Array.isArray(pack.deck) || pack.deck.length === 0) return {ok:false, msg:'문제 목록(deck)이 없습니다.'};

    for (const it of pack.deck) {
      const kind = String(it.kind || 'mcq').toLowerCase();
      if (!it.question || !Array.isArray(it.choices)) return {ok:false, msg:'문제 형식이 올바르지 않습니다.'};
      if (kind === 'ox') {
        if (it.choices.length !== 2) return {ok:false, msg:'OX 문제 choices는 2개여야 합니다.'};
        if (!(it.answerIndex === 0 || it.answerIndex === 1)) return {ok:false, msg:'OX answerIndex가 올바르지 않습니다.'};
      } else {
        if (it.choices.length !== 4) return {ok:false, msg:'4지선다 choices는 4개여야 합니다.'};
        if (!(it.answerIndex >= 0 && it.answerIndex <= 3)) return {ok:false, msg:'answerIndex가 올바르지 않습니다.'};
      }
    }

    // settings optional
    if (!pack.settings) pack.settings = { showAnswer: true, qMode: 'mcq', activityMinutes: DEFAULTS.activityMinutes };
    if (!Number.isFinite(pack.settings.activityMinutes)) pack.settings.activityMinutes = DEFAULTS.activityMinutes;
    return {ok:true};
  }

  function applyPack(pack, {resetDeck=true}={}) {
    state.pack = pack;

    // rebuild queues for deck consumption
    const mcq = [];
    const ox = [];
    (pack.deck || []).forEach((it) => {
      const kind = String(it.kind || 'mcq').toLowerCase();
      if (kind === 'ox') ox.push(it);
      else mcq.push(it);
    });
    state.deckQueues = { mcq, ox };
    if (resetDeck) state.deckPos = { mcq: 0, ox: 0 };

    const topicLine = document.querySelector('[data-pack-topic]');
    if (topicLine) topicLine.textContent = `문제: ${pack.topic} (총 ${pack.deck.length}문항)`;

    if (!state.started) {
      state.remaining = getConfiguredGameSeconds();
      setTimer();
    }

    logLine(`문제 파일 적용: ${pack.topic} / ${pack.deck.length}문항`);
  }

  function exportCurrentPack() {
    if (!state.pack) {
      alert('저장할 문제 파일이 없습니다. (교사: 먼저 문제 적용 / 학생: 파일 불러오기)');
      return;
    }
    // ensure exported pack includes timer setting
    const cfg = getAiConfig();
    if (!state.pack.settings) state.pack.settings = {};
    state.pack.settings.activityMinutes = Number.isFinite(state.pack.settings.activityMinutes) ? state.pack.settings.activityMinutes : clamp(Number(cfg.activityMinutes), 1, 180);

    const name = `주제형_보드게임_문제_${(state.pack.topic||'topic').replace(/\s+/g,'_')}_${nowStamp().slice(0,10)}.json`;
    downloadText(name, JSON.stringify(state.pack, null, 2));
  }

  // ---------- gemini (teacher) ----------
  async function geminiGenerateDeck({topic, count, model, apiKey, qMode}) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const prompt = [
      '당신은 초등 5~6학년 수업용 4지선다 퀴즈 제작자입니다.',
      '주어진 주제로 보드게임에서 학생 2명이 풀 수 있는 짧은 문제를 만듭니다.',
      '반드시 JSON 배열만 출력합니다(다른 텍스트 금지).',
      '스키마(4지선다): { "kind":"mcq", "question":"...", "choices":["...","...","...","..."], "answerIndex":0~3, "explain":"(1~2문장)" }',
      '스키마(OX): { "kind":"ox", "question":"...", "choices":["O","X"], "answerIndex":0~1, "explain":"(1~2문장)" }',
      'choices에는 정답이 하나만 있도록 구성하고, answerIndex는 정답 보기의 인덱스입니다.',
      '',
      `주제: ${topic}`,
      `개수: ${count}`,
      `문항 구성: ${qMode === 'mcq_ox' ? '4지선다 중심 + 일부 OX 포함' : '4지선다만'}`,
      '언어: 한국어',
      '난이도: 초등 5~6학년 수준',
    ].join('\n');

const body = {
  contents: [{ role: 'user', parts: [{ text: prompt }] }],
  generationConfig: { temperature: 0.6, maxOutputTokens: 8192, responseMimeType: 'application/json' },
};

const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
const raw = await res.text();

if (!res.ok) {
  if (res.status === 429) throw new Error('Gemini 사용 한도(Quota/Rate limit)로 요청이 차단되었습니다. AI Studio에서 결제/할당량 상태를 확인하세요.');
  if (raw.includes('overloaded')) throw new Error('Gemini 모델이 혼잡합니다. 잠시 후 다시 시도하세요.');
  throw new Error(`Gemini 오류: ${raw.slice(0, 400)}`);
}

// Extract model text
let t = '';
try {
  const obj = JSON.parse(raw);
  const parts = obj?.candidates?.[0]?.content?.parts || [];
  t = parts.map(p => p?.text || '').join('').trim();
} catch {}

// Parse JSON (array preferred). If broken, recover objects.
let parsed = safeJsonParse(t);
let arr = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed?.questions) ? parsed.questions
        : Array.isArray(parsed?.deck) ? parsed.deck
        : Array.isArray(parsed?.items) ? parsed.items
        : null;

if (!Array.isArray(arr)) {
  const objs = extractObjectsFromText(t);
  if (Array.isArray(objs) && objs.length) arr = objs;
}

if (!Array.isArray(arr)) {
  throw new Error('Gemini 응답을 해석할 수 없습니다. (JSON 배열 필요)\n\n--- Gemini 원문(일부) ---\n' + String(t).slice(0, 900));
}

    const deck = arr.map((it) => {
      const kind = String(it.kind || 'mcq').trim().toLowerCase();
      const question = String(it.question || '').trim();

      // choices normalization (Gemini sometimes returns 4+ options or numbered strings)
      let choices = Array.isArray(it.choices) ? it.choices.map(x => String(x).trim()) : [];
      if (choices.length > 4 && (kind !== 'ox')) choices = choices.slice(0, 4);

      const explain = String(it.explain || '').trim();

      // answerIndex normalization:
      // - allow 0-based (0~3) or 1-based (1~4)
      // - allow string numbers
      let ai = Number.isFinite(Number(it.answerIndex)) ? Number(it.answerIndex) : NaN;

      if (!question) return null;

      if (kind === 'ox') {
        const c = (choices.length === 2) ? choices : ['O','X'];
        // allow 0/1 or 1/2
        // Prefer 0-based (0/1). If ai===2, it's clearly 1-based second choice -> convert.
        if (ai === 2) ai = 1;
        if (!(ai === 0 || ai === 1)) ai = 0;
        return { kind:'ox', question, choices: c, answerIndex: ai, explain };
      }

      // mcq
      if (choices.length !== 4) return null;

      // Prefer 0-based (0~3). Some outputs may be 1-based (1~4).
      // Heuristic:
      // - ai === 4  -> clearly 1-based, convert to 3
      // - ai === 0  -> clearly 0-based
      // - ai in 1~3 -> ambiguous; keep as-is (assume 0-based) to avoid off-by-one errors.
      if (ai === 4) ai = 3;
      if (!(ai >= 0 && ai <= 3)) return null;

      return { kind:'mcq', question, choices, answerIndex: ai, explain };
    }).filter(Boolean);

    // post-fix: align answerIndex with explanation when model is inconsistent
    deck.forEach((q)=>{ try{ fixAnswerIndexByExplain(q); }catch(e){} });

    if (deck.length === 0) throw new Error('생성된 문제가 없습니다.');
    return deck;
  }


  // Generate deck in batches to reliably reach requested count (avoids token truncation).
  async function geminiGenerateDeckBatched({ topic, count, model, apiKey, qMode }) {
    const target = clamp(Number(count) || DEFAULTS.deckCount, 6, 200);

    // batch size to stay within token limits
    const batchSize = Math.min(16, target);
    const out = [];
    const seen = new Set();

    // hard stop to avoid infinite loops
    let guard = 0;
    while (out.length < target && guard < 30) {
      guard++;
      const remain = target - out.length;
      const n = Math.min(batchSize, remain);

      const deckPart = await geminiGenerateDeck({
        topic: `${topic}\n(이미 만든 문제와 중복 없이 새 문제만, 남은 개수: ${n}개)\n(각 문항에서 explain이 가리키는 정답과 answerIndex가 반드시 일치)`,
        count: n,
        model,
        apiKey,
        qMode
      });

      for (const q of deckPart) {
        const key = (q.kind + '|' + q.question).slice(0, 200);
        if (seen.has(key)) continue;
        seen.add(key);
        try { fixAnswerIndexByExplain(q); } catch(e) {}
        out.push(q);
        if (out.length >= target) break;
      }

      // if Gemini returned nothing usable, stop
      if (!deckPart || deckPart.length === 0) break;
    }

    // Final strict fill if still short
    if (out.length < target) {
      const remain = target - out.length;
      const deckPart = await geminiGenerateDeck({
        topic: `${topic}\n(부족한 ${remain}개를 채우기. 중복 금지. JSON 배열만. explain 1문장)\n(각 문항에서 explain이 가리키는 정답과 answerIndex가 반드시 일치)`,
        count: remain,
        model,
        apiKey,
        qMode
      });

      for (const q of deckPart) {
        const key = (q.kind + '|' + q.question).slice(0, 200);
        if (seen.has(key)) continue;
        seen.add(key);
        try { fixAnswerIndexByExplain(q); } catch(e) {}
        out.push(q);
        if (out.length >= target) break;
      }
    }

    return out.slice(0, target);
  }

  function nextQuestion(kindWanted='mcq') {
    if (!state.pack || !Array.isArray(state.pack.deck) || state.pack.deck.length === 0) return null;

    const q = (k) => {
      const arr = state.deckQueues?.[k] || [];
      const pos = state.deckPos?.[k] || 0;
      if (pos >= arr.length) return null;
      state.deckPos[k] = pos + 1;
      return arr[pos];
    };

    // try wanted kind first
    let item = q(kindWanted);

    // fallback: if OX exhausted, use mcq; if mcq exhausted, use ox
    if (!item && kindWanted === 'ox') item = q('mcq');
    if (!item && kindWanted === 'mcq') item = q('ox');

    if (!item) return { _depleted:true };
    return item;
  }

  // ---------- modals ----------
  const openModal = (el) => el?.classList.add('open');
  const closeModal = (el) => el?.classList.remove('open');

const showNotice = (title, text) => {
  const modal = $('#resultModal');
  const titleEl = $('#resultTitle') || modal?.querySelector('h3');
  const textEl = $('#resultText');
  if (titleEl) titleEl.textContent = title || '안내';
  if (textEl) {
    if (textEl.tagName === 'TEXTAREA' || 'value' in textEl) textEl.value = text || '';
    else textEl.textContent = text || '';
  }
  openModal(modal);
};



const showBoardBanner = (mainText, subText = '', ms = 1200) => {
  const wrap = document.querySelector('.boardWrap');
  if (!wrap) return;
  // remove existing
  wrap.querySelectorAll('.boardBanner').forEach(n => n.remove());

  const banner = document.createElement('div');
  banner.className = 'boardBanner';
  banner.innerHTML = `
    <div class="bannerCard">
      <span>${escapeHtml(String(mainText || ''))}</span>
    </div>
  `;
  wrap.appendChild(banner);

  if (subText) {
    const card = banner.querySelector('.bannerCard');
    const sub = document.createElement('div');
    sub.className = 'bannerSub';
    sub.textContent = String(subText);
    card.appendChild(sub);
  }

  window.setTimeout(() => {
    try { banner.remove(); } catch {}
  }, ms);
};


  
  function askQuestion(kindWanted='mcq') {
    const q = nextQuestion(kindWanted);
    if (!q) { alert('문제 파일이 없습니다. (교사: 문제 적용 / 학생: 문제 파일 불러오기)'); return; }
    if (q._depleted) { alert('문제 덱이 모두 소진되었습니다.'); return; }

    state.currentQuestion = q;
    state.selectedChoice = null;

    const total = state.pack?.deck?.length || 0;
    const used = (state.deckPos?.mcq || 0) + (state.deckPos?.ox || 0);
    els.qTitle.textContent = `${q.kind === 'ox' ? 'OX' : '4지선다'} (${used}/${total})`;
    els.qText.textContent = q.question || '';

    // render choices
    const wrap = els.choiceWrap;
    if (wrap) wrap.innerHTML = '';
    const labels = (q.kind === 'ox') ? ['O','X'] : ['①','②','③','④'];

    (q.choices || []).forEach((c, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn';
      btn.dataset.index = String(i);
      btn.innerHTML = `<span class="choice-meta"><span class="choice-badge">${labels[i] || (i+1)}</span><span class="choice-text">${escapeHtml(String(c))}</span></span>`;
      btn.addEventListener('click', () => {
        state.selectedChoice = i;
        wrap?.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
      wrap?.appendChild(btn);
    });

    openModal(els.qModal);
  }

  function gradeAnswer() {
    const q = state.currentQuestion;
    if (!q) return;

    if (state.selectedChoice === null || state.selectedChoice === undefined) {
      alert('보기를 선택해주세요.');
      return;
    }

    const correct = (Number(state.selectedChoice) === Number(q.answerIndex));

    // feedback sound
    if (correct) playCorrectSound(); else playWrongSound();

    if (correct) state.score[state.turn] += 1;
    setScores();

    closeModal(els.qModal);

    const showAnswer = !!(state.pack?.settings?.showAnswer);

    const ansText = escapeHtml(q.choices?.[q.answerIndex] ?? '');
    const expText = q.explain ? `<br/><span style="color:var(--muted)">${escapeHtml(q.explain)}</span>` : '';

    if (MODE === 'teacher') {
      // Teacher view: plain text (no HTML/code-like tags)
      const label = correct ? '정답!' : '오답!';
      const lines = [];
      lines.push(label);
      if (showAnswer) {
        lines.push(`정답: ${q.choices?.[q.answerIndex] ?? ''}`);
        if (q.explain) lines.push(`해설: ${q.explain}`);
      }
      if ('value' in els.resultText) els.resultText.value = lines.join('\n');
      else els.resultText.textContent = lines.join('\n');
    } else {
      // Student view: formatted HTML
      els.resultText.innerHTML = correct
        ? (showAnswer ? `<b>정답!</b><br/>정답: ${ansText}${expText}` : `<b>정답!</b>`)
        : (showAnswer ? `<b>오답!</b><br/>정답: ${ansText}${expText}` : `<b>오답!</b>`);
    }

    openModal(els.resultModal);
  }


  // ---------- dice face ----------
  function setDiceFace(n) {
    const dots = {
      1: [[2,2]],
      2: [[1,1],[3,3]],
      3: [[1,1],[2,2],[3,3]],
      4: [[1,1],[1,3],[3,1],[3,3]],
      5: [[1,1],[1,3],[2,2],[3,1],[3,3]],
      6: [[1,1],[1,3],[2,1],[2,3],[3,1],[3,3]],
    };
    const pts = dots[n] || dots[1];
    els.dice.innerHTML = pts.map(([r,c]) => `<span class="pip" style="--r:${r};--c:${c}"></span>`).join('');
  }
  setDiceFace(1);

  // ---------- movement / turns ----------
  const playerName = () => (state.turn === 0 ? '빨강' : '파랑');

  function advanceTurn() {
    state.turn = 1 - state.turn;
    logLine(`현재 차례 → ${playerName()}`);
  }

  function movePlayer(p, steps) {
    const from = state.pos[p];
    const to = (from + steps + path.length) % path.length;
    state.pos[p] = to;
    drawTokens();

    const cell = cells[to];
    logLine(`${p===0?'빨강':'파랑'} ${steps>=0?'+':''}${steps}칸 → ${cell.label}${cell._n ?? ''}`);

    if (cell.kind === 'action') {
      if (cell.action === 'skip') {
        state.skip[p] += 1;
        logLine(`${p===0?'빨강':'파랑'} : 한 번 쉬기`);
        // Big on-board banner so students can immediately notice the skip
        showBoardBanner('한 번 쉬기', '이번 턴은 쉽니다.', 1400);
        showNotice('⏸️ 한 번 쉬기', '이번 턴은 쉽니다. 다음 차례로 넘어갑니다.');
        window.setTimeout(() => advanceTurn(), 1400);
        return;
      }
      if (cell.action === 'move') {
        logLine(`${p===0?'빨강':'파랑'} : ${cell.value>0?cell.value+'칸 앞으로':(-cell.value)+'칸 뒤로'}`);
        movePlayer(p, cell.value);
        return;
      }
    }

    if (cell.kind === 'quiz') {
      const want = (cell.qtype === 'ox') ? 'ox' : 'mcq';
      askQuestion(want);
      return;
    }

    advanceTurn();
  }

  function rollDice() {
    if (!state.started) { alert('먼저 "게임 시작하기"를 눌러주세요.'); return; }
    const p = state.turn;

    if (state.skip[p] > 0) {
      state.skip[p] -= 1;
      logLine(`${playerName()} : 쉬기(턴 스킵)`);
      advanceTurn();
      return;
    }

    // dice animation (1~2s) then move + show question
    els.rollBtn.disabled = true;
    els.dice?.classList.add('rolling');
    playDiceSound();
    const n = 1 + Math.floor(Math.random() * 6);
    els.diceResult.textContent = '주사위: ...';

    setTimeout(() => {
      els.dice?.classList.remove('rolling');
      els.diceResult.textContent = `주사위: ${n}`;
      setDiceFace(n);
      movePlayer(p, n);
      els.rollBtn.disabled = false;
    }, 1200);
  }

  // ---------- timer ----------
  function stopTimer() { if (state.timerId) clearInterval(state.timerId); state.timerId = null; }

  function startTimer() {
    stopTimer();
    state.remaining = getConfiguredGameSeconds();
    setTimer();
    state.timerId = setInterval(() => {
      state.remaining -= 1;
      setTimer();
      if (state.remaining <= 0) {
        stopTimer();
        state.started = false;
        alert(`시간 종료!\n빨강:${state.score[0]} / 파랑:${state.score[1]}`);
      }
    }, 1000);
  }

  function startGame() {
    state.started = true;
    state.turn = 0;
    state.pos = [0,0];
    state.score = [0,0];
    state.skip = [0,0];
    setScores();
    drawTokens();
    startTimer();
    logLine('게임 시작! 현재 차례 → 빨강');
  }

  function resetGame() {
    state.started = false;
    stopTimer();
    state.turn = 0;
    state.pos = [0,0];
    state.score = [0,0];
    state.skip = [0,0];
    state.remaining = getConfiguredGameSeconds();
    setScores();
    setTimer();
    drawTokens();
    logLine('다시하기 완료');
  }

  // ---------- teacher: apply topic ----------
  async function onApplyTopic() {
    const topic = (els.topicInput?.value || '').trim();
    if (!topic) { alert('주제를 입력하세요.'); return; }

    const apiKey = getSavedKey().trim();
    if (!apiKey) { alert('Gemini API 키가 필요합니다. [설정]에서 API 키를 저장한 뒤 다시 시도하세요.'); refreshSetupHint(); return; }

    const cfg = getAiConfig();
    const model = els.modelSel?.value || cfg.model;
    const count = clamp(Number(els.deckCount?.value || cfg.deckCount), 6, 200);

    els.applyTopic.disabled = true;
    els.applyTopic.textContent = '생성 중...';

    try {
      const aiCfg0 = getAiConfig() || {};
      const qMode = aiCfg0.qMode || (els.qMode?.value) || DEFAULTS.qMode;
      const deck = await geminiGenerateDeckBatched({ topic, count, model, apiKey, qMode });
      const aiCfg = getAiConfig() || {};
      const pack = { version: 3, topic, createdAt: nowStamp(), model, settings: { showAnswer: aiCfg.showAnswer ?? true, qMode: aiCfg.qMode || DEFAULTS.qMode, activityMinutes: getConfiguredMinutes() }, deck };
      applyPack(pack, {resetDeck:true});
      saveLastPack(pack);
      alert(`완료!\n"${topic}" 문제 ${deck.length}개 생성됨\n학생용 페이지에서는 ‘문제 파일 저장’ 후 불러오기만 하면 됩니다.`);
    } catch (e) {
      alert(String(e?.message || e));
    } finally {
      els.applyTopic.disabled = false;
      els.applyTopic.textContent = '문제 적용';
    }
  }

  // ---------- settings drawer (teacher) ----------
  function openDrawer() { els.drawer?.classList.add('open'); }
  function closeDrawer() { els.drawer?.classList.remove('open'); }

  function onSaveKey() {
    const v = (els.apiKeyInput.value || '').trim();
    if (!v) { alert('API 키를 입력하세요.'); return; }
    setSavedKey(v);
    refreshSetupHint();
    alert('API 키를 저장했습니다. (이 PC/브라우저에만 저장)');
  }
  function onDeleteKey() {
    clearSavedKey();
    if (els.apiKeyInput) els.apiKeyInput.value = '';
    refreshSetupHint();
    alert('API 키를 삭제했습니다.');
  }

  function onSaveAi() {
    const model = els.modelSel?.value || DEFAULTS.model;
    const qMode = els.qMode?.value || DEFAULTS.qMode;
    const showAnswer = !!(els.showAnswer?.checked);
    const deckCount = clamp(Number(els.deckCount?.value || DEFAULTS.deckCount), 6, 200);
    const activityMinutes = clamp(Number(els.activityMinutes?.value || DEFAULTS.activityMinutes), 1, 180);
    setAiConfig({ model, qMode, showAnswer, deckCount, activityMinutes });

    // reflect into current pack (so 학생용 파일에도 반영)
    if (state.pack) {
      if (!state.pack.settings) state.pack.settings = {};
      state.pack.settings.activityMinutes = activityMinutes;
      saveLastPack(state.pack);
    }

    // reflect into timer UI (다음 게임부터 적용)
    if (!state.started) {
      state.remaining = getConfiguredGameSeconds();
      setTimer();
    }
    alert('설정을 저장했습니다.');
  }

  async function onTestAi() {
    const apiKey = getSavedKey().trim();
    if (!apiKey) { alert('API 키가 없습니다.'); return; }
    const model = els.modelSel?.value || DEFAULTS.model;
    try {
      const qMode = els.qMode?.value || DEFAULTS.qMode;
      await geminiGenerateDeck({ topic: '연결 테스트', count: 2, model, apiKey, qMode });
      alert('연결 성공!');
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  // ---------- file import ----------
  function triggerImport() { els.importPackInput?.click(); }

  async function onImportFile(file) {
    const text = await file.text();
    const pack = safeJsonParse(text);
    const v = validatePack(pack);
    if (!v.ok) { alert(v.msg); return; }
    applyPack(pack, {resetDeck:true});
    saveLastPack(pack);
  }

  // ---------- wire events ----------
  els.rollBtn?.addEventListener('click', rollDice);
  els.startGame?.addEventListener('click', startGame);
  els.resetGame?.addEventListener('click', resetGame);

  els.exportPack?.addEventListener('click', exportCurrentPack);
  els.importPack?.addEventListener('click', triggerImport);
  els.importPackInput?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) onImportFile(f);
    e.target.value = '';
  });

  els.aSubmit?.addEventListener('click', gradeAnswer);
  els.aClose?.addEventListener('click', () => { closeModal(els.qModal); advanceTurn(); });

els.resultClose?.addEventListener('click', () => { closeModal(els.resultModal); advanceTurn(); });

if (MODE !== 'teacher') {
  els.resultCopy?.addEventListener('click', async () => {
    const v = (els.resultText && (els.resultText.value ?? els.resultText.textContent)) || '';
    try { await navigator.clipboard.writeText(String(v)); } catch {}
  });

  els.resultDownload?.addEventListener('click', () => {
    const v = (els.resultText && (els.resultText.value ?? els.resultText.textContent)) || '';
    downloadText('gemini_raw.txt', String(v), 'text/plain');
  });
} else {
  // Teacher view: remove copy/download buttons
  els.resultCopy?.remove();
  els.resultDownload?.remove();
}

  if (MODE === 'teacher') {
    els.applyTopic?.addEventListener('click', onApplyTopic);

    els.settingsBtn?.addEventListener('click', openDrawer);
    els.openSettingsInline?.addEventListener('click', openDrawer);
    els.closeSettings?.addEventListener('click', closeDrawer);
    els.drawer?.querySelector('.drawer__backdrop')?.addEventListener('click', closeDrawer);

    els.saveKey?.addEventListener('click', onSaveKey);
    els.deleteKey?.addEventListener('click', onDeleteKey);
    els.getKeyBtn?.addEventListener('click', () => window.open('https://aistudio.google.com/app/apikey', '_blank', 'noopener'));
    els.saveAi?.addEventListener('click', onSaveAi);
    els.testAi?.addEventListener('click', onTestAi);

    const cfg = getAiConfig();
    if (els.modelSel) els.modelSel.value = cfg.model;
    if (els.qMode) els.qMode.value = cfg.qMode || DEFAULTS.qMode;
    if (els.showAnswer) els.showAnswer.checked = !!cfg.showAnswer;
    if (els.deckCount) els.deckCount.value = String(cfg.deckCount);
    if (els.activityMinutes) els.activityMinutes.value = String(cfg.activityMinutes ?? DEFAULTS.activityMinutes);
    if (els.apiKeyInput) els.apiKeyInput.value = getSavedKey();
    refreshSetupHint();
  }

  // restore last pack
  const last = loadLastPack();
  if (last && validatePack(last).ok) applyPack(last, {resetDeck:false});
  else {
    // no pack yet: show configured timer
    state.remaining = getConfiguredGameSeconds();
    setTimer();
  }
})();
