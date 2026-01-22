
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
}

    const deck = arr.map((it) => {
      const kind = String(it.kind || 'mcq').trim();
      const question = String(it.question || '').trim();
      const choices = Array.isArray(it.choices) ? it.choices.map(x => String(x).trim()) : [];
      const answerIndex = Number.isFinite(Number(it.answerIndex)) ? Number(it.answerIndex) : -1;
      const explain = String(it.explain || '').trim();

      if (!question) return null;

      if (kind === 'ox') {
        const c = (choices.length === 2) ? choices : ['O','X'];
        const ai = (answerIndex === 0 || answerIndex === 1) ? answerIndex : 0;
        return { kind:'ox', question, choices: c, answerIndex: ai, explain };
      }

      // mcq
      if (choices.length !== 4) return null;
      if (!(answerIndex >= 0 && answerIndex <= 3)) return null;
      return { kind:'mcq', question, choices, answerIndex, explain };
    }).filter(Boolean);

    if (deck.length === 0) throw new Error('생성된 문제가 없습니다.');
    return deck;
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
  if (textEl) textEl.textContent = text || '';
  openModal(modal);
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

    if (correct) state.score[state.turn] += 1;
    setScores();

    closeModal(els.qModal);

    const showAnswer = !!(state.pack?.settings?.showAnswer);

    const ansText = escapeHtml(q.choices?.[q.answerIndex] ?? '');
    const expText = q.explain ? `<br/><span style="color:var(--muted)">${escapeHtml(q.explain)}</span>` : '';

    els.resultText.innerHTML = correct
      ? (showAnswer ? `<b>정답!</b><br/>정답: ${ansText}${expText}` : `<b>정답!</b>`)
      : (showAnswer ? `<b>오답!</b><br/>정답: ${ansText}${expText}` : `<b>오답!</b>`);

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
        showNotice('⏸️ 한 번 쉬기', '이번 턴은 쉽니다. 다음 차례로 넘어갑니다.');
        advanceTurn();
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

    const n = 1 + Math.floor(Math.random() * 6);
    els.diceResult.textContent = `주사위: ${n}`;
    setDiceFace(n);
    movePlayer(p, n);
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
    logLine('리셋 완료');
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
      const deck = await geminiGenerateDeck({ topic, count, model, apiKey, qMode });
      const aiCfg = getAiConfig() || {};
      const pack = { version: 3, topic, createdAt: nowStamp(), model, settings: { showAnswer: aiCfg.showAnswer ?? true, qMode: aiCfg.qMode || DEFAULTS.qMode, activityMinutes: getConfiguredMinutes() }, deck };
      applyPack(pack, {resetDeck:true});
      saveLastPack(pack);
      alert(`완료!\n"${topic}" 문제 ${deck.length}개 생성됨\n학생용 페이지에서는 ‘문제 파일 저장’ 후 불러오기만 하면 됩니다.`);
    } catch (e) {
      const msg = String(e?.message || e);
      showNotice("오류", msg);
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
      const msg = String(e?.message || e);
      showNotice("오류", msg);
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
