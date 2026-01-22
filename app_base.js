/*
  주제형 한바퀴 보드게임
  - 업로드된 '정선아리랑 한바퀴 놀이판' 구조(둘레 path, 2인 턴제, 문제 모달, 액션칸) 기반으로
    '주제 적용 → 문제 교체' + '저장/복원' + '설정(톱니)' UX를 정적 웹앱으로 재구성.
*/

(() => {
  'use strict';

  const STORAGE_KEYS = {
    state: 'TOPIC_BOARDGAME_STATE_V1',
    geminiKey: 'GEMINI_API_KEY',
    aiConfig: 'TOPIC_BOARDGAME_AI_CONFIG_V1',
  };

  const DEFAULTS = {
    cols: 10,
    rows: 6,
    gameSeconds: 420,
    defaultTopic: '정선아리랑',
    model: 'gemini-2.0-flash',
    count: 22,
  };

  const els = {
    // top
    openSettings: document.getElementById('openSettings'),

    // controls
    topicInput: document.getElementById('topicInput'),
    applyTopic: document.getElementById('applyTopic'),
    startGame: document.getElementById('startGame'),
    resetGame: document.getElementById('resetGame'),
    rollBtn: document.getElementById('rollBtn'),
    dice: document.getElementById('dice'),
    diceResult: document.getElementById('diceResult'),
    log: document.getElementById('log'),

    // status
    cellsStatus: document.getElementById('cellsStatus'),
    aiStatus: document.getElementById('aiStatus'),

    // score
    scoreP1: document.getElementById('scoreP1'),
    scoreP2: document.getElementById('scoreP2'),
    timer: document.getElementById('timer'),

    // board
    board: document.getElementById('board'),

    // modal
    qModal: document.getElementById('qModal'),
    questionLabel: document.getElementById('questionLabel'),
    questionText: document.getElementById('questionText'),
    questionImg: document.getElementById('questionImg'),
    answerInput: document.getElementById('answerInput'),
    submitAnswer: document.getElementById('submitAnswer'),
    resultModal: document.getElementById('resultModal'),
    resultContent: document.getElementById('resultContent'),
    endModal: document.getElementById('endModal'),
    endContent: document.getElementById('endContent'),

    // storage (파일 저장/불러오기)
    exportFile: document.getElementById('exportFile'),
    importFile: document.getElementById('importFile'),
    clearData: document.getElementById('clearData'),

    // settings drawer
    drawer: document.getElementById('drawer'),
    closeSettings: document.getElementById('closeSettings'),
    saveAi: document.getElementById('saveAi'),
    deleteKey: document.getElementById('deleteKey'),
    testAi: document.getElementById('testAi'),

    geminiModel: document.getElementById('geminiModel'),
    genCount: document.getElementById('genCount'),
    apiKeyInput: document.getElementById('apiKeyInput'),
    getKeyBtn: document.getElementById('getKeyBtn'),

    storagePreview: document.getElementById('storagePreview'),
  };

  // ---------- Utilities ----------

  function clamp(n, a, b) { return Math.min(Math.max(n, a), b); }

  function safeJsonParse(text) {
  if (!text) return null;
  let t = String(text).trim();

  // 1) ```json ... ``` code fence extraction
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) t = fence[1].trim();

  // 2) direct parse
  try { return JSON.parse(t); } catch {}

  // 3) try slice array/object envelope
  const a0 = t.indexOf('['), a1 = t.lastIndexOf(']');
  if (a0 !== -1 && a1 !== -1 && a1 > a0) {
    const sub = t.slice(a0, a1 + 1).trim();
    try { return JSON.parse(sub); } catch {}
  }
  const o0 = t.indexOf('{'), o1 = t.lastIndexOf('}');
  if (o0 !== -1 && o1 !== -1 && o1 > o0) {
    const sub = t.slice(o0, o1 + 1).trim();
    try { return JSON.parse(sub); } catch {}
  }

  // 4) fallback: extract top-level JSON objects {...} and build an array
  const objs = extractTopLevelJsonObjects(t);
  if (objs && objs.length) return objs;

  return null;
}

// Extracts top-level JSON objects from noisy text.
// Useful when the model outputs a sequence of { ... } blocks with stray text between.
function extractTopLevelJsonObjects(t) {
  const out = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;

  for (let i = 0; i < t.length; i++) {
    const ch = t[i];

    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = false; continue; }
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
})();
