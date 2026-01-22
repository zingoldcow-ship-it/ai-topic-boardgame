
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

    // room share (teacher)
    makeRoom: $('makeRoom'),
    showRoomQr: $('showRoomQr'),
    copyRoomLink: $('copyRoomLink'),
    roomCodeText: $('roomCodeText'),
    roomQrOverlay: $('roomQrOverlay'),
    roomQrCanvas: $('roomQrCanvas'),
    roomQrCodeText: $('roomQrCodeText'),
    closeRoomQr: $('closeRoomQr'),

    // join (student)
    joinOverlay: $('joinOverlay'),
    joinCodeInput: $('joinCodeInput'),
    joinCodeBtn: $('joinCodeBtn'),
    joinErr: $('joinErr'),

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

  // ---------- realtime room (Firebase Firestore) ----------
  const ROOM = {
    storageKey: 'TOPIC_BOARDGAME_ROOM_CODE_V1',
    collection: 'rooms',
  };

  let db = null;
  let currentRoomCode = null;
  let roomUnsub = null;

  function initFirebase() {
    try {
      const cfg = window.FIREBASE_CONFIG;
      if (!cfg || !cfg.projectId || !cfg.apiKey) return false;
      if (!window.firebase || !firebase.initializeApp) return false;
      if (firebase.apps && firebase.apps.length === 0) {
        firebase.initializeApp(cfg);
      } else if (!firebase.apps) {
        firebase.initializeApp(cfg);
      }
      db = firebase.firestore();
      return true;
    } catch (e) {
      console.warn('firebase init failed', e);
      return false;
    }
  }

  function isRoomCode(s) {
    return /^[0-9]{6}$/.test(String(s || ''));
  }

  function studentLinkForRoom(code) {
    const u = new URL('./student.html', window.location.href);
    u.searchParams.set('room', code);
    return u.toString();
  }

  async function roomSetPack(code, pack) {
    if (!db) return;
    await db.collection(ROOM.collection).doc(code).set({
      pack,
      updatedAt: Date.now(),
    }, { merge: true });
  }

  async function createRoom() {
    if (!db) return null;
    // collision check
    for (let i = 0; i < 10; i++) {
      const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
      const ref = db.collection(ROOM.collection).doc(code);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({ createdAt: Date.now(), config: { activityMinutes: getAiConfig().activityMinutes } }, { merge: true });
        return code;
      }
    }
    return null;
  }

  function bindRoomTeacherUi() {
    if (!els.makeRoom) return;

    const fbOk = initFirebase();
    if (!fbOk) {
      // Firebase 미설정이면 버튼을 비활성화하고 안내만 제공
      els.makeRoom.disabled = true;
      if (els.showRoomQr) els.showRoomQr.disabled = true;
      if (els.copyRoomLink) els.copyRoomLink.disabled = true;
      if (els.roomCodeText) els.roomCodeText.textContent = '설정필요';
      addLog('실시간 공유: firebase-config.js에 Firebase 설정을 입력해야 합니다.');
      return;
    }

    // restore
    const saved = localStorage.getItem(ROOM.storageKey);
    if (isRoomCode(saved)) {
      currentRoomCode = saved;
      if (els.roomCodeText) els.roomCodeText.textContent = currentRoomCode;
      if (els.showRoomQr) els.showRoomQr.disabled = false;
      if (els.copyRoomLink) els.copyRoomLink.disabled = false;
    }

    els.makeRoom.addEventListener('click', async () => {
      const code = await createRoom();
      if (!code) {
        alert('수업 코드를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      currentRoomCode = code;
      localStorage.setItem(ROOM.storageKey, code);
      if (els.roomCodeText) els.roomCodeText.textContent = code;
      if (els.showRoomQr) els.showRoomQr.disabled = false;
      if (els.copyRoomLink) els.copyRoomLink.disabled = false;
      addLog(`수업 코드 생성: ${code}`);

      // 현재 팩이 있으면 즉시 업로드
      const pack = loadLastPack();
      if (pack) {
        try {
          await roomSetPack(code, pack);
          addLog('현재 문제팩을 학생용에 공유했습니다.');
        } catch (e) {
          console.warn(e);
          addLog('문제팩 공유에 실패했습니다(네트워크/DB 설정 확인).');
        }
      }
    });

    if (els.copyRoomLink) {
      els.copyRoomLink.addEventListener('click', async () => {
        if (!isRoomCode(currentRoomCode)) return;
        const link = studentLinkForRoom(currentRoomCode);
        try {
          await navigator.clipboard.writeText(link);
          addLog('학생용 링크를 클립보드에 복사했습니다.');
        } catch {
          prompt('아래 링크를 복사해서 학생에게 공유하세요:', link);
        }
      });
    }

    if (els.showRoomQr) {
      els.showRoomQr.addEventListener('click', () => {
        if (!isRoomCode(currentRoomCode)) return;
        const link = studentLinkForRoom(currentRoomCode);
        if (els.roomQrCodeText) els.roomQrCodeText.textContent = currentRoomCode;
        if (els.roomQrOverlay) els.roomQrOverlay.style.display = 'flex';
        // QR 생성 (로컬 생성: 외부 CDN/네트워크 불필요)
if (els.roomQrCanvas && window.qrcodegen && window.qrcodegen.QrCode) {
  try {
    drawQrToCanvas(els.roomQrCanvas, link);
  } catch (e) { console.warn(e); }
} else {
  console.warn('QR 라이브러리(qrcodegen) 로드 실패');
}
);
        }
      });
    }

    if (els.closeRoomQr && els.roomQrOverlay) {
      els.closeRoomQr.addEventListener('click', () => {
        els.roomQrOverlay.style.display = 'none';
      });
      els.roomQrOverlay.addEventListener('click', (e) => {
        if (e.target === els.roomQrOverlay) els.roomQrOverlay.style.display = 'none';
      });
    }
  }

  function bindRoomStudentUi() {
    // 학생은 room 파라미터가 있으면 자동 연결, 없으면 입력 오버레이
    const fbOk = initFirebase();
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');

    const goJoin = () => {
      if (els.joinOverlay) els.joinOverlay.style.display = 'flex';
    };

    if (!fbOk) {
      // Firebase 미설정이면 기존 파일 방식으로만 사용
      if (room) {
        if (els.joinErr) {
          els.joinErr.style.display = 'block';
          els.joinErr.textContent = '실시간 수업 입장은 Firebase 설정이 필요합니다. 선생님께 링크 대신 문제 파일을 받아 불러오세요.';
        }
        goJoin();
      }
      // join overlay 버튼 동작은 동일(페이지 이동)
    }

    if (els.joinCodeBtn && els.joinCodeInput) {
      els.joinCodeBtn.addEventListener('click', () => {
        const code = String(els.joinCodeInput.value || '').trim();
        if (!isRoomCode(code)) {
          if (els.joinErr) {
            els.joinErr.style.display = 'block';
            els.joinErr.textContent = '6자리 숫자 코드를 입력하세요.';
          }
          return;
        }
        const u = new URL(window.location.href);
        u.searchParams.set('room', code);
        window.location.href = u.toString();
      });
      els.joinCodeInput.addEventListener('input', () => {
        els.joinCodeInput.value = els.joinCodeInput.value.replace(/\D/g, '').slice(0, 6);
      });
    }

    if (!isRoomCode(room)) {
      goJoin();
      return;
    }

    currentRoomCode = room;

    if (!fbOk || !db) {
      goJoin();
      return;
    }

    // 연결
    if (els.joinOverlay) els.joinOverlay.style.display = 'none';
    addLog(`수업 코드로 연결: ${room}`);

    const ref = db.collection(ROOM.collection).doc(room);
    if (roomUnsub) roomUnsub();
    roomUnsub = ref.onSnapshot((snap) => {
      const data = snap.data() || {};
      const roomMinutes = Number(data?.config?.activityMinutes);

      // 1) 교사 설정(활동시간)은 pack보다 우선
      const hasRoomMinutes = Number.isFinite(roomMinutes) && roomMinutes > 0;

      // 2) 교사가 올린 팩이 있으면 적용 (단, roomMinutes가 있으면 settings를 강제 덮어쓰기)
      if (data.pack) {
        try {
          const pack = data.pack;
          if (hasRoomMinutes) {
            if (!pack.settings) pack.settings = {};
            pack.settings.activityMinutes = roomMinutes;
          }
          saveLastPack(pack);
          applyPack(pack);
        } catch (e) {
          console.warn(e);
        }
      }

      // 3) 팩이 없어도 roomMinutes만으로 타이머를 즉시 반영
      if (hasRoomMinutes && !state.started) {
        state.remaining = Math.round(roomMinutes * 60);
        setTimer();
      }
    });
  }

  function drawQrToCanvas(canvas, text) {
  const qr = window.qrcodegen.QrCode.encodeText(String(text), window.qrcodegen.QrCode.Ecc.MEDIUM);
  const size = qr.size;
  const border = 2; // modules
  const ctx = canvas.getContext('2d');
  const scale = Math.floor(Math.min(canvas.width, canvas.height) / (size + border * 2));
  const drawSize = (size + border * 2) * scale;
  // center
  const ox = Math.floor((canvas.width - drawSize) / 2);
  const oy = Math.floor((canvas.height - drawSize) / 2);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#000';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (qr.getModule(x, y)) {
        ctx.fillRect(ox + (x + border) * scale, oy + (y + border) * scale, scale, scale);
      }
    }
  }
}

// ---------- utils ----------
  const clamp = (n, a, b) => Math.min(Math.max(n, a), b);

  function safeJsonParse(text) {
    try { return JSON.parse(text); } catch {}
    return null;
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
    arr[0] = { kind:'start', label:'시작->' };
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
      const icon = (cell.kind === 'start') ? '🏁'
        : (cell.kind === 'action' && cell.action === 'skip') ? '⏸️'
        : (cell.kind === 'action' && cell.value > 0) ? '➡️'
        : (cell.kind === 'action' && cell.value < 0) ? '⬅️'
        : (cell.kind === 'quiz' && cell.qtype === 'ox') ? '❓'
        : '📝';

      el.innerHTML = `<span class="tile-label"><span class="tile-emoji">${icon}</span><span class="tile-text">${badge}</span></span>`;
    }
  }

  const grid = buildGrid();
  const path = buildPerimeterPath();
  const cells = baseLayout(path.length);
  renderTiles(grid, path, cells);

  // ---------- state ----------
  const state = {
    started: false,
    turn: 0,
    pos: [0,0],
    score: [0,0],
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
      generationConfig: { temperature: 0.6, maxOutputTokens: 2048 },
    };

    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const raw = await res.text();

    if (!res.ok) {
      if (res.status === 429) throw new Error('Gemini 사용 한도(Quota/Rate limit)로 요청이 차단되었습니다. AI Studio에서 결제/할당량 상태를 확인하세요.');
      if (raw.includes('overloaded')) throw new Error('Gemini 모델이 혼잡합니다. 잠시 후 다시 시도하세요.');
      throw new Error(`Gemini 오류: ${raw.slice(0, 400)}`);
    }

    // Gemini response is JSON; extract text and parse JSON array
    let arr = null;
    try {
      const obj = JSON.parse(raw);
      const t = obj?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      arr = safeJsonParse(t);
    } catch {}
    if (!Array.isArray(arr)) throw new Error('Gemini 응답을 해석할 수 없습니다. (JSON 배열 필요)');

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
      // 실시간 공유(수업 코드) 사용 중이면 DB에 업로드
      if (isRoomCode(currentRoomCode) && db) {
        try {
          await roomSetPack(currentRoomCode, pack);
          addLog('학생용(수업 코드)으로 문제팩을 바로 공유했습니다.');
        } catch (e) {
          console.warn(e);
          addLog('문제팩 실시간 공유에 실패했습니다(네트워크/DB 설정 확인).');
        }
      }
      alert(`완료!\n"${topic}" 문제 ${deck.length}개 생성됨\n(수업 코드 공유를 쓰면 학생용에 자동 반영됩니다)`);
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

// 현재 수업방이 있으면(실시간 공유 중이면) 방 설정도 동기화
if (db && currentRoomCode) {
  db.collection(ROOM.collection).doc(currentRoomCode)
    .set({ config: { activityMinutes } }, { merge: true })
    .catch((e) => console.warn(e));
}


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

  if (MODE === 'teacher') {
    bindRoomTeacherUi();
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
  } else {
    bindRoomStudentUi();
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
