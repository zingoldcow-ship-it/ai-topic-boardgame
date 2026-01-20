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
    model: 'gemini-1.5-flash',
    count: 22,
    mode: 'offline', // offline | geminiDirect | geminiProxy
    proxyUrl: '',
    autoSave: true,
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

    // storage
    autoSave: document.getElementById('autoSave'),
    exportJson: document.getElementById('exportJson'),
    importJson: document.getElementById('importJson'),
    clearData: document.getElementById('clearData'),

    // settings drawer
    drawer: document.getElementById('drawer'),
    closeSettings: document.getElementById('closeSettings'),
    saveAi: document.getElementById('saveAi'),
    deleteKey: document.getElementById('deleteKey'),
    testAi: document.getElementById('testAi'),

    aiMode: document.getElementById('aiMode'),
    geminiModel: document.getElementById('geminiModel'),
    genCount: document.getElementById('genCount'),
    proxyUrl: document.getElementById('proxyUrl'),
    apiKeyInput: document.getElementById('apiKeyInput'),

    storagePreview: document.getElementById('storagePreview'),
  };

  // ---------- Utilities ----------

  function clamp(n, a, b) { return Math.min(Math.max(n, a), b); }

  function safeJsonParse(text) {
    try { return JSON.parse(text); } catch { /* ignore */ }
    // try: extract first JSON array
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
      const slice = text.slice(start, end + 1);
      try { return JSON.parse(slice); } catch { /* ignore */ }
    }
    return null;
  }

  function downloadText(filename, content, mime = 'application/json') {
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

  function nowIso() {
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function setPill(el, text, tone = 'muted') {
    el.textContent = text;
    el.classList.remove('pill--ok', 'pill--danger');
    if (tone === 'ok') el.classList.add('pill--ok');
    if (tone === 'danger') el.classList.add('pill--danger');
  }

  function logLine(msg) {
    els.log.innerHTML += `${escapeHtml(msg)}<br>`;
    els.log.scrollTop = els.log.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  // ---------- Dice (original-style SVG) ----------

  function dieSVG(n) {
    const d = (x, y) => `<circle cx='${x}' cy='${y}' r='9' fill='#2c3e50'/>`;
    const f = [
      d(50, 50),
      d(30, 30) + d(70, 70),
      d(30, 30) + d(50, 50) + d(70, 70),
      d(30, 30) + d(70, 30) + d(30, 70) + d(70, 70),
      d(30, 30) + d(70, 30) + d(30, 50) + d(70, 50) + d(30, 70) + d(70, 70),
      d(30, 30) + d(70, 30) + d(30, 50) + d(70, 50) + d(30, 70) + d(70, 70) + d(50, 50),
    ];
    return `<svg viewBox='0 0 100 100'><rect x='5' y='5' width='90' height='90' rx='14' ry='14'
      fill='#fff' stroke='#2c3e50' stroke-width='7'/>${f[n - 1]}</svg>`;
  }

  async function animateRoll(finalN) {
    let i = 0;
    return await new Promise((res) => {
      const iv = setInterval(() => {
        const n = Math.floor(Math.random() * 6) + 1;
        els.dice.innerHTML = dieSVG(n);
        if (++i > 8) {
          clearInterval(iv);
          els.dice.innerHTML = dieSVG(finalN);
          res();
        }
      }, 60);
    });
  }

  // ---------- Cell model / layout ----------

  const Q = (label, q, a, img = null) => ({ label, q, a, img });
  const A = (label, action, value = null) => ({ label, action, value });

  // 기본 세트: "정선아리랑" (업로드된 원본 문제를 동일하게 포함)
  // 총 칸 수(둘레 path)와 길이가 동일할 때 그대로 사용합니다.
  const PRESET_CELLS_JEONGSEON = [
    { label: '시작->' },
    Q('문화재 유형','정선아리랑은 문화재보호법상 어떤 종류(무형·유형)로 지정되어 있나요?','무형','https://img7.yna.co.kr/etc/inner/KR/2024/05/12/AKR20240512041800005_02_i_P4.jpg'),
    Q('자연환경','정선아리랑은 정선의 어떤 자연환경에서 비롯된 민요인가요? (산골 / 강변)','강변','https://mblogthumb-phinf.pstatic.net/MjAxODA2MTVfMTg1/MDAxNTI4OTg5NDYwMTgx.Y4ojYKus4rykrSfRpTFUkfgN53QVAjp4xlKFhqEfLMog.izyfGPewVwUXYAVhsUwXsRhBB6KL9PsPEZ9LXncUbjcg.JPEG.smallwingone/image_952847741528988818746.jpg?type=w800'),
    Q('유래','고려왕조를 섬기던 선비들이 고려가 망하자 정선지방에 숨어 지내면서 두 임금을 섬기지 않는 충절과 고향에 대한 그리움이 담긴____를 지어 부르는 것에서 유래되었다고 전해진다. 빈칸에 들어갈 말은 무엇일까요?','시|한시','https://cdn.kado.net/news/photo/202212/1157916_585637_3814.jpg'),
    Q('지역','정선아리랑이 전승되는 도(道)는 어디인가요?','강원도|강원특별자치도','https://i.pinimg.com/564x/92/e7/50/92e75007b9243af05b2b6e9b0d4bc5bd.jpg'),
    Q('감정','정선아리랑의 주요 감정은 무엇일까요? (슬픔 / 기쁨, 택 1)','슬픔','https://img.seoul.co.kr/img/upload/2019/10/04/SSI_20191004094529.jpg'),
    Q('장단','세마치장단은 (   )소박 (   )박자이다. 괄호 안에 들어갈 숫자는?','3','https://folkency.nfm.go.kr/upload/img/20170205/20170205212807_t_.jpg'),
    Q('용도','정선아리랑은 주로 모심기와 같은 ____일을 할 때 많이 불렀던 노래입니다.','농사','https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/%EC%A6%9D%ED%8F%89%EB%AA%A8%EB%82%B4%EA%B8%B0.jpg/250px-%EC%A6%9D%ED%8F%89%EB%AA%A8%EB%82%B4%EA%B8%B0.jpg'),
    Q('아우라지','“아우라지”는 두 ___이 만나는 곳으로, 뗏목을 엮어 한양으로 보내던 곳이다. 빈 칸에 알맞은 낱말은 무엇인가요?','물|강|강물','https://mblogthumb-phinf.pstatic.net/MjAyMjEwMTZfMjM1/MDAxNjY1OTA2ODI2NjA2.sIJHNIxDH4X4wo5hrVVMT1s80DDRHfd3uD3qWIaDlGAg.GIEbBCXFianbB6llTJVcN-3K7mhnGFOM3eW8rosRjMUg.PNG.goeun061133/%EC%A0%95%EC%84%A0%EC%95%84%EC%9A%B0%EB%9D%BC%EC%A7%80-20.png?type=w800'),
    Q('지정번호','정선아리랑은 강원도 무형문화재 제 몇 호일까요?(숫자만 입력)','1','https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRmTg0TDOqI0gIF1Xf2p6UgxddEUzPM0BJTPw&s'),
    A('한 번 쉬기','skip'),
    Q('곡조 특징','정선아리랑은 잔잔한 흐름 속에 소박하면서도 여인의 한숨과 같은 (           )을 지니고 있다’ → 빈칸에 들어갈 말은?','슬픔|한|서러움|서글픔','https://i.ytimg.com/vi/2nFxSWJh_KA/sddefault.jpg'),
    Q('전승 형태','정선아리랑은 전통적으로 (집단 / 독창) 형식으로 불렸다.','집단','https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRr9wYRXQnUa4AL6Wng_jIONaMeXq4M4_jmwQ&s'),
    Q('OX퀴즈','정선아리랑은 노동요다: O / X','O','https://upload.wikimedia.org/wikipedia/commons/d/d4/Chain_gang_-_convicts_going_to_work_nr._Sidney_N.S._Wales.jpg'),
    Q('메나리토리','메나리토리는 우리나라 동부지역 민요에서 주로 사용되는 음악적 특징이며 주로 (___· 솔· ____· ____·레) 5음계를 사용한다. 빈칸에 들어갈 3음을 적으시오.(띄어쓰기 없이 작성)','미라도|미도라|라미도|도미라|도라미|라도미','https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/Menaritori_scale.png/960px-Menaritori_scale.png'),
    Q('엮음 정의','빠르게 엮어 부르는 정선아리랑의 명칭은 무엇일까요?','엮음아라리','https://devin.aks.ac.kr/image/0a3078eb-1444-476a-9fb7-fa37e2b2cd94?preset=page'),
    Q('긴 정의','느리고 길게 부르는 정선아리랑의 명칭은 무엇일까요?','긴아라리','https://devin.aks.ac.kr/image/0a3078eb-1444-476a-9fb7-fa37e2b2cd94?preset=page'),
    A('두 칸 앞으로','move',2),
    Q('지정 연도','정선아리랑의 강원도 무형문화재 지정 연도는 언제일까요?(숫자만 작성)','1971','https://cdn.kado.net/news/thumbnail/201806/918186_380607_2311_v150.jpg'),
    Q('OX퀴즈','정선아리랑은 일반 아리랑보다 대체적으로 느리다: O / X','O',null),
    A('두 칸 뒤로','move',-2),
    Q('축제','정선아리랑제는 어느 계절에 열릴까요? (봄 / 가을)','가을','https://www.ktsketch.co.kr/news/photo/202209/7206_36179_4236.jpg'),
    Q('노래 목적','정선아리랑은 노동 뒤 무엇을 달래기 위해 불렀을까요?','마음|한|슬픔','https://cdn.kado.net/news/photo/200701/2007012301036.jpg'),
    Q('슬로건','정선아리랑의 슬로건으로 더 어울리는 건 무엇일까요? : “느림 속의 위로” / “빠른 희망의 노래”','느림 속의 위로','https://arirangfestival.kr/images/cibi.jpg'),
    Q('유네스코','“아리랑”이 유네스코 인류무형문화유산에 등록된 연도는 언제일까요? (숫자만)','2012',null),
    Q('보유자','현재 유영란, 김남기, 김형조, 김길자 씨가 정선아리랑 예능보유자로 활동 중이며, (        )씨가 명예보유자로 인정되어 있습니다. 괄호 안에 들어갈 낱말은?','최봉출','https://cdn.kado.net/news/photo/201810/932476_389622_2407.jpg'),
    A('한 번 쉬기','skip'),
    Q('자연·인간','가사에는 자연과 인간의 ___가 강조된다. 빈칸에 알맞을 말을 쓰세요.','조화',null),
  ];


  function baseLayout(total) {
    const arr = Array.from({ length: total }, () => null);
    arr[0] = { label: '시작->' };
    arr[Math.floor(total * 0.35)] = A('한 번 쉬기', 'skip');
    arr[Math.floor(total * 0.55)] = A('두 칸 앞으로', 'move', 2);
    arr[Math.floor(total * 0.72)] = A('두 칸 뒤로', 'move', -2);
    arr[Math.floor(total * 0.88)] = A('한 번 쉬기', 'skip');
    return arr;
  }

  function offlineTemplateQuestions(topic, n) {
    const templates = [
      (t, i) => Q(`핵심${i + 1}`, `${t}의 핵심 개념 1가지를 설명해 보세요.`, '교사확인'),
      (t, i) => Q(`정의${i + 1}`, `${t}에서 중요한 용어 1개를 골라 뜻을 쓰세요.`, '교사확인'),
      (t, i) => Q(`OX${i + 1}`, `${t}와 관련된 진술을 하나 만들고 O/X로 판단해 보세요.`, '교사확인'),
      (t, i) => Q(`예시${i + 1}`, `${t}의 예(사례)를 1가지 들어보세요.`, '교사확인'),
      (t, i) => Q(`비교${i + 1}`, `${t}와 비슷한 개념 1가지를 비교해 차이를 말해보세요.`, '교사확인'),
      (t, i) => Q(`이유${i + 1}`, `${t}에서 “왜?”가 중요한 이유를 1문장으로 말해보세요.`, '교사확인'),
    ];
    return Array.from({ length: n }, (_, i) => templates[i % templates.length](topic, i));
  }

  function mergeQuestionsIntoLayout(layout, questions) {
    const slots = layout
      .map((v, i) => (v === null ? i : -1))
      .filter((i) => i >= 0);

    if (questions.length < slots.length) {
      // 부족하면 템플릿으로 채우기
      const extra = offlineTemplateQuestions('추가문제', slots.length - questions.length);
      questions = questions.concat(extra);
    }

    slots.forEach((idx, j) => {
      layout[idx] = questions[j];
    });

    return layout;
  }

  function buildCellsOffline(topic, total) {
    const norm = String(topic || '').trim();

    // 원본과 동일한 기본 세트(정선아리랑) 유지
    if (norm === DEFAULTS.defaultTopic && total === PRESET_CELLS_JEONGSEON.length) {
      // 깊은 복사(상태 수정 방지)
      return PRESET_CELLS_JEONGSEON.map((c) => ({ ...c }));
    }

    // 기본: 액션칸 고정 + 주제형 템플릿 문제로 채우기
    const layout = baseLayout(total);
    const slots = layout.filter((v) => v === null).length;
    const qs = offlineTemplateQuestions(norm || DEFAULTS.defaultTopic, slots);
    return mergeQuestionsIntoLayout(layout, qs);
  }

  function iconFor(cell, index) {
    const label = cell?.label ?? '';
    if (index === 0) return '🏁';
    if (label.includes('OX')) return '❓';
    if (label.includes('두 칸 앞')) return '➡️';
    if (label.includes('두 칸 뒤')) return '⬅️';
    if (label.includes('쉬기')) return '⏸️';
    if (cell?.q) return '📝';
    if (cell?.action) return '🎯';
    return '•';
  }

  // ---------- Board path / render ----------

  const COLS = DEFAULTS.cols;
  const ROWS = DEFAULTS.rows;

  function buildPerimeterPath(cols, rows) {
    const path = [];
    for (let c = 0; c < cols; c++) path.push([0, c]);
    for (let r = 1; r < rows - 1; r++) path.push([r, cols - 1]);
    for (let c = cols - 1; c >= 0; c--) path.push([rows - 1, c]);
    for (let r = rows - 2; r > 0; r--) path.push([r, 0]);
    return path;
  }

  const path = buildPerimeterPath(COLS, ROWS);
  const grid = new Map(); // "r-c" -> element

  function initBoardSkeleton() {
    els.board.innerHTML = `
      <div id="rails"><span class="t"></span><span class="r"></span><span class="b"></span><span class="l"></span></div>
      <div id="boardCenter"><div class="centerNote">주제형 보드게임</div></div>
    `;

    const k = (r, c) => `${r}-${c}`;

    path.forEach(([r, c], i) => {
      const el = document.createElement('div');
      el.className = 'cell edge label';
      el.style.gridRow = (r + 1);
      el.style.gridColumn = (c + 1);
      grid.set(k(r, c), el);
      els.board.appendChild(el);
    });
  }

  function renderTileLabels(cells) {
    path.forEach(([r, c], i) => {
      const el = grid.get(`${r}-${c}`);
      const cell = cells[i] || { label: '(빈칸)' };

      el.classList.remove('type-quiz', 'type-action', 'start');
      if (cell.q) el.classList.add('type-quiz');
      else if (cell.action) el.classList.add('type-action');
      if (i === 0) el.classList.add('start');

      const emoji = iconFor(cell, i);
      el.innerHTML = `<span class="tile-label"><span class="tile-emoji">${emoji}</span><span>${escapeHtml(cell.label || '')}</span></span>`;
    });
  }

  // ---------- Game state ----------

  const players = [
    { name: '빨강', cls: 'p1', pos: 0, score: 0, skip: false, token: null },
    { name: '파랑', cls: 'p2', pos: 0, score: 0, skip: false, token: null },
  ];

  let cells = []; // active cells
  let topic = DEFAULTS.defaultTopic;
  let turn = 0;
  let sec = DEFAULTS.gameSeconds;
  let ticker = null;
  let gameRunning = false;

  function createTokens() {
    players.forEach((p) => {
      const t = document.createElement('div');
      t.className = `token ${p.cls}`;
      p.token = t;
    });
  }

  function placeTokens() {
    path.forEach(([r, c]) => {
      const el = grid.get(`${r}-${c}`);
      if (!el) return;
      // remove existing tokens in this cell
      Array.from(el.querySelectorAll('.token')).forEach((node) => node.remove());
    });

    players.forEach((p) => {
      const [r, c] = path[p.pos];
      const el = grid.get(`${r}-${c}`);
      if (!el) return;
      el.appendChild(p.token);
    });
  }

  function updScores() {
    els.scoreP1.textContent = `🔴 빨강: ${players[0].score}`;
    els.scoreP2.textContent = `🔵 파랑: ${players[1].score}`;
  }

  function setTimerText() {
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    els.timer.textContent = `⏳ ${mm}:${ss}`;
  }

  function startTimer() {
    sec = DEFAULTS.gameSeconds;
    setTimerText();
    if (ticker) clearInterval(ticker);
    ticker = setInterval(() => {
      sec -= 1;
      setTimerText();
      if (sec <= 0) {
        clearInterval(ticker);
        finishGame();
      }
    }, 1000);
  }

  function showModal(modal, show) {
    if (show) modal.classList.add('show');
    else modal.classList.remove('show');
  }

  function nextTurn() {
    turn = (turn + 1) % players.length;
    logLine(`현재 차례 → ${players[turn].name}`);
  }

  function normalizeAnswer(s) {
    return String(s ?? '').trim().toUpperCase().replaceAll(' ', '');
  }

  function isCorrect(cell, answer) {
    const user = normalizeAnswer(answer);
    const accepted = String(cell.a ?? '')
      .split('|')
      .map((x) => normalizeAnswer(x));

    return accepted.some((x) => x !== '' && x === user);
  }

  function movePlayer(pl, steps) {
    let np = pl.pos + steps;
    if (np >= cells.length) {
      pl.score += 2;
      updScores();
      logLine(`${pl.name} 한 바퀴 +2점`);
      np %= cells.length;
    }
    if (np < 0) np += cells.length;
    pl.pos = np;
    placeTokens();
    const label = cells[np]?.label ?? '';
    logLine(`${pl.name} ${(steps > 0 ? '+' : '') + steps}칸 → ${label}`);
    handleCell(pl, cells[np]);
  }

  function handleCell(pl, cell) {
    if (!cell) {
      nextTurn();
      return;
    }

    if (cell.action) {
      if (cell.action === 'skip') {
        logLine(`${pl.name} 한 턴 쉬기`);
        pl.skip = true;
        nextTurn();
        return;
      }
      if (cell.action === 'move') {
        movePlayer(pl, Number(cell.value || 0));
        return;
      }
    }

    if (cell.q) {
      els.questionLabel.textContent = cell.label;
      els.questionText.textContent = cell.q;
      if (cell.img) {
        els.questionImg.src = cell.img;
        els.questionImg.style.display = 'block';
      } else {
        els.questionImg.style.display = 'none';
      }
      els.answerInput.value = '';
      showModal(els.qModal, true);
      return;
    }

    nextTurn();
  }

  function startGame() {
    gameRunning = true;
    els.rollBtn.disabled = false;

    players.forEach((p) => {
      p.pos = 0;
      p.score = 0;
      p.skip = false;
    });

    turn = 0;
    placeTokens();
    updScores();
    els.log.innerHTML = '';
    logLine(`게임 시작! 현재 차례 → ${players[turn].name}`);
    startTimer();
    persistIfAutoSave();
  }

  function resetGame() {
    gameRunning = false;
    els.rollBtn.disabled = true;
    if (ticker) clearInterval(ticker);
    sec = DEFAULTS.gameSeconds;
    setTimerText();

    players.forEach((p) => {
      p.pos = 0;
      p.score = 0;
      p.skip = false;
    });

    turn = 0;
    placeTokens();
    updScores();
    els.log.innerHTML = '';
    logLine('리셋됨');
    showModal(els.endModal, false);
    persistIfAutoSave();
  }

  function finishGame() {
    els.rollBtn.disabled = true;
    if (ticker) clearInterval(ticker);

    const p0 = players[0];
    const p1 = players[1];
    let msg = '🤝 무승부!';
    if (p0.score !== p1.score) {
      msg = `🏆 ${(p0.score > p1.score ? p0 : p1).name} 승리!`;
    }

    els.endContent.textContent = msg;
    showModal(els.endModal, true);
    logLine(msg);
    persistIfAutoSave();
  }

  // ---------- AI generation (Gemini) ----------

  function loadAiConfig() {
    const raw = localStorage.getItem(STORAGE_KEYS.aiConfig);
    const cfg = raw ? safeJsonParse(raw) : null;
    return {
      mode: cfg?.mode ?? DEFAULTS.mode,
      model: cfg?.model ?? DEFAULTS.model,
      count: clamp(Number(cfg?.count ?? DEFAULTS.count), 8, 60),
      proxyUrl: cfg?.proxyUrl ?? DEFAULTS.proxyUrl,
    };
  }

  function saveAiConfig(cfg) {
    localStorage.setItem(STORAGE_KEYS.aiConfig, JSON.stringify(cfg));
  }

  function getGeminiKey() {
    return localStorage.getItem(STORAGE_KEYS.geminiKey) || '';
  }

  function setGeminiKey(key) {
    localStorage.setItem(STORAGE_KEYS.geminiKey, key);
  }

  function deleteGeminiKey() {
    localStorage.removeItem(STORAGE_KEYS.geminiKey);
  }

  function aiPromptFor(topic, count) {
    return `너는 초등 5~6학년 수업용 퀴즈 제작자다.\n\n[주제]\n${topic}\n\n[요구]\n- 총 ${count}개 문제를 만들어라.\n- 반드시 JSON 배열로만 출력하라(설명/코드블록/마크다운 금지).\n- 각 원소는 다음 스키마를 따른다: {"label":"짧은라벨","q":"문제","a":"정답"}\n- label: 2~8글자, 문제 유형이 드러나게(예: 개념,OX,예시,용어,적용 등)\n- q: 한 문장 중심(최대 60자), 초등학생이 이해 가능\n- a: 짧게. 복수정답은 '|'로 구분(예: "미|밀")\n- OX 문제는 a를 "O" 또는 "X"로\n- 외부 링크/이미지는 넣지 마라(img는 사용하지 않음).\n\n[JSON만 출력]`;
  }

  async function geminiGenerateDirect({ topic, model, count }) {
    const apiKey = getGeminiKey();
    if (!apiKey) throw new Error('API 키가 없습니다. (설정에서 입력)');

    // Google Generative Language API - generateContent
    // https://ai.google.dev/ (공식 문서 참조)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: aiPromptFor(topic, count) }],
        },
      ],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 2048,
      },
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (!resp.ok) {
      const msg = data?.error?.message || JSON.stringify(data);
      throw new Error(`Gemini 오류: ${msg}`);
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || '').join('') || '';
    const parsed = safeJsonParse(text);
    if (!Array.isArray(parsed)) throw new Error('AI 응답을 JSON 배열로 파싱하지 못했습니다.');
    return parsed;
  }

  async function geminiGenerateViaProxy({ topic, model, count, proxyUrl }) {
    if (!proxyUrl) throw new Error('프록시 URL이 없습니다. (설정에서 입력)');

    const url = proxyUrl.replace(/\/$/, '') + '/generate';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, model, count }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.error || `프록시 오류 (HTTP ${resp.status})`);
    }

    if (!Array.isArray(data?.questions)) throw new Error('프록시 응답이 올바르지 않습니다.');
    return data.questions;
  }

  function sanitizeQuestions(items) {
    const out = [];
    for (const it of items || []) {
      if (!it) continue;
      const label = String(it.label ?? '').trim();
      const q = String(it.q ?? '').trim();
      const a = String(it.a ?? '').trim();
      if (!label || !q || !a) continue;
      out.push({ label, q, a, img: null });
    }
    return out;
  }

  async function buildCellsWithAiOrOffline(nextTopic) {
    const cfg = loadAiConfig();

    // slots count equals number of nulls in base layout
    const layout = baseLayout(path.length);
    const slotCount = layout.filter((x) => x === null).length;

    if (cfg.mode === 'offline') {
      setPill(els.aiStatus, 'AI: 미사용', 'muted');
      return buildCellsOffline(nextTopic, path.length);
    }

    setPill(els.aiStatus, 'AI: 생성 중…', 'muted');

    const desired = clamp(Number(cfg.count || slotCount), 8, 60);
    const count = Math.max(slotCount, desired);

    let raw;
    if (cfg.mode === 'geminiDirect') {
      raw = await geminiGenerateDirect({ topic: nextTopic, model: cfg.model, count });
    } else if (cfg.mode === 'geminiProxy') {
      raw = await geminiGenerateViaProxy({ topic: nextTopic, model: cfg.model, count, proxyUrl: cfg.proxyUrl });
    } else {
      throw new Error('알 수 없는 AI 모드');
    }

    const questions = sanitizeQuestions(raw);
    if (questions.length < slotCount) {
      throw new Error(`AI가 만든 문제 수가 부족합니다. (${questions.length}/${slotCount})`);
    }

    const merged = mergeQuestionsIntoLayout(layout, questions);
    setPill(els.aiStatus, `AI: 사용 (${cfg.model})`, 'ok');
    return merged;
  }

  // ---------- Persistence ----------

  function buildAppState() {
    const cfg = loadAiConfig();
    return {
      version: 1,
      updatedAt: nowIso(),
      topic,
      cells,
      game: {
        running: gameRunning,
        turn,
        sec,
        players: players.map((p) => ({ name: p.name, cls: p.cls, pos: p.pos, score: p.score, skip: p.skip })),
      },
      ai: {
        mode: cfg.mode,
        model: cfg.model,
        count: cfg.count,
        proxyUrl: cfg.proxyUrl,
        hasLocalKey: Boolean(getGeminiKey()),
      },
    };
  }

  function persistIfAutoSave() {
    if (!els.autoSave.checked) return;
    const state = buildAppState();
    localStorage.setItem(STORAGE_KEYS.state, JSON.stringify(state));
    refreshStoragePreview();
  }

  function loadSavedState() {
    const raw = localStorage.getItem(STORAGE_KEYS.state);
    const state = raw ? safeJsonParse(raw) : null;
    if (!state || typeof state !== 'object') return null;
    if (!Array.isArray(state.cells) || state.cells.length !== path.length) return null;
    return state;
  }

  function applyState(state) {
    topic = String(state.topic || DEFAULTS.defaultTopic);
    cells = state.cells;

    // game
    const g = state.game || {};
    gameRunning = Boolean(g.running);
    turn = Number.isFinite(g.turn) ? g.turn : 0;
    sec = Number.isFinite(g.sec) ? g.sec : DEFAULTS.gameSeconds;

    const ps = Array.isArray(g.players) ? g.players : [];
    players.forEach((p, i) => {
      const s = ps[i] || {};
      p.pos = Number.isFinite(s.pos) ? clamp(s.pos, 0, cells.length - 1) : 0;
      p.score = Number.isFinite(s.score) ? s.score : 0;
      p.skip = Boolean(s.skip);
    });

    // ui
    els.topicInput.value = topic;
    renderTileLabels(cells);
    placeTokens();
    updScores();
    setTimerText();
    els.rollBtn.disabled = !gameRunning;

    setPill(els.cellsStatus, `문제: ${topic}`, 'ok');
    refreshAiStatusPill();
    refreshStoragePreview();
  }

  function refreshStoragePreview() {
    const keys = [STORAGE_KEYS.state, STORAGE_KEYS.aiConfig, STORAGE_KEYS.geminiKey];
    const snapshot = {};
    for (const k of keys) {
      const v = localStorage.getItem(k);
      snapshot[k] = v ? (k === STORAGE_KEYS.geminiKey ? '*** (저장됨)' : safeJsonParse(v) || v) : null;
    }
    els.storagePreview.textContent = JSON.stringify(snapshot, null, 2);
  }

  function refreshAiStatusPill() {
    const cfg = loadAiConfig();
    if (cfg.mode === 'offline') {
      setPill(els.aiStatus, 'AI: 미사용', 'muted');
      return;
    }

    if (cfg.mode === 'geminiDirect') {
      const has = Boolean(getGeminiKey());
      setPill(els.aiStatus, has ? `AI: 직접 (${cfg.model})` : 'AI: 직접 (키 필요)', has ? 'ok' : 'danger');
      return;
    }

    if (cfg.mode === 'geminiProxy') {
      const has = Boolean(cfg.proxyUrl);
      setPill(els.aiStatus, has ? `AI: 프록시 (${cfg.model})` : 'AI: 프록시 (URL 필요)', has ? 'ok' : 'danger');
      return;
    }

    setPill(els.aiStatus, 'AI: 미사용', 'muted');
  }

  // ---------- Events ----------

  async function onApplyTopic() {
    const nextTopic = els.topicInput.value.trim();
    if (!nextTopic) return;

    els.applyTopic.disabled = true;
    els.applyTopic.textContent = '적용 중…';

    try {
      topic = nextTopic;
      const nextCells = await buildCellsWithAiOrOffline(topic);
      cells = nextCells;
      renderTileLabels(cells);

      setPill(els.cellsStatus, `문제: ${topic}`, 'ok');

      // 게임은 중간에 바뀌면 혼란이 커서 리셋
      resetGame();
      persistIfAutoSave();

      logLine(`주제 적용: ${topic}`);
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
      refreshAiStatusPill();
    } finally {
      els.applyTopic.disabled = false;
      els.applyTopic.textContent = '문제 적용';
    }
  }

  async function onRoll() {
    if (!gameRunning) return;

    const p = players[turn];
    if (p.skip) {
      logLine(`${p.name} 쉬는 턴`);
      p.skip = false;
      nextTurn();
      persistIfAutoSave();
      return;
    }

    const n = Math.floor(Math.random() * 6) + 1;
    await animateRoll(n);
    els.diceResult.textContent = `주사위: ${n}`;
    movePlayer(p, n);
    persistIfAutoSave();
  }

  function onSubmitAnswer() {
    showModal(els.qModal, false);

    const cell = cells[players[turn].pos];
    const ok = isCorrect(cell, els.answerInput.value);

    if (ok) {
      players[turn].score += 1;
      updScores();
    }

    els.resultContent.textContent = ok
      ? '✅ 정답!!'
      : `❌ 오답!!\n정답: ${String(cell.a).split('|')[0]}`;

    showModal(els.resultModal, true);
    setTimeout(() => {
      showModal(els.resultModal, false);
      nextTurn();
      persistIfAutoSave();
    }, 1500);
  }

  function openDrawer(show) {
    if (show) {
      els.drawer.classList.add('show');
      document.body.classList.add('no-scroll');
      syncSettingsUIFromStorage();
      refreshStoragePreview();
    } else {
      els.drawer.classList.remove('show');
      document.body.classList.remove('no-scroll');
    }
  }

  function syncSettingsUIFromStorage() {
    const cfg = loadAiConfig();
    els.aiMode.value = cfg.mode;
    els.geminiModel.value = cfg.model;
    els.genCount.value = String(cfg.count);
    els.proxyUrl.value = cfg.proxyUrl;
    els.apiKeyInput.value = getGeminiKey();

    refreshAiStatusPill();
  }

  function onSaveAi() {
    const cfg = {
      mode: els.aiMode.value,
      model: els.geminiModel.value,
      count: clamp(Number(els.genCount.value || DEFAULTS.count), 8, 60),
      proxyUrl: els.proxyUrl.value.trim(),
    };

    saveAiConfig(cfg);

    const key = els.apiKeyInput.value.trim();
    if (key) setGeminiKey(key);

    refreshAiStatusPill();
    persistIfAutoSave();
    alert('AI 설정이 저장되었습니다.');
  }

  function onDeleteKey() {
    deleteGeminiKey();
    els.apiKeyInput.value = '';
    refreshAiStatusPill();
    persistIfAutoSave();
    alert('API 키를 삭제했습니다.');
  }

  async function onTestAi() {
    const cfg = {
      mode: els.aiMode.value,
      model: els.geminiModel.value,
      count: clamp(Number(els.genCount.value || DEFAULTS.count), 8, 60),
      proxyUrl: els.proxyUrl.value.trim(),
    };

    const tryTopic = '테스트(과학)';
    try {
      if (cfg.mode === 'offline') {
        alert('오프라인 모드는 연결 테스트가 필요 없습니다.');
        return;
      }

      if (cfg.mode === 'geminiDirect') {
        if (els.apiKeyInput.value.trim()) setGeminiKey(els.apiKeyInput.value.trim());
        const qs = await geminiGenerateDirect({ topic: tryTopic, model: cfg.model, count: 8 });
        alert(`성공: ${Array.isArray(qs) ? qs.length : 0}개 문제 생성`);
        return;
      }

      if (cfg.mode === 'geminiProxy') {
        const qs = await geminiGenerateViaProxy({ topic: tryTopic, model: cfg.model, count: 8, proxyUrl: cfg.proxyUrl });
        alert(`성공: ${Array.isArray(qs) ? qs.length : 0}개 문제 생성`);
        return;
      }

      alert('알 수 없는 AI 모드');
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    }
  }

  function onExportJson() {
    const state = buildAppState();
    const filename = `topic-boardgame_${state.topic}_${new Date().toISOString().slice(0,10)}.json`;
    downloadText(filename, JSON.stringify(state, null, 2));
  }

  function onImportJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const state = safeJsonParse(text);
      if (!state || typeof state !== 'object') {
        alert('올바른 JSON 파일이 아닙니다.');
        return;
      }
      if (!Array.isArray(state.cells) || state.cells.length !== path.length) {
        alert('이 앱의 데이터 형식이 아니거나, 말판 길이가 다릅니다.');
        return;
      }
      localStorage.setItem(STORAGE_KEYS.state, JSON.stringify(state));
      applyState(state);
      alert('가져오기 완료');
    };
    reader.readAsText(file, 'utf-8');
  }

  function onClearData() {
    const ok = confirm('정말로 모든 데이터(문제/설정/키)를 삭제할까요? 이 작업은 되돌릴 수 없습니다.');
    if (!ok) return;

    localStorage.removeItem(STORAGE_KEYS.state);
    localStorage.removeItem(STORAGE_KEYS.aiConfig);
    localStorage.removeItem(STORAGE_KEYS.geminiKey);

    // reset in-memory
    topic = DEFAULTS.defaultTopic;
    els.topicInput.value = topic;

    // offline default cells
    cells = buildCellsOffline(topic, path.length);
    renderTileLabels(cells);

    resetGame();
    refreshAiStatusPill();
    setPill(els.cellsStatus, '문제: 기본 세트', 'muted');
    refreshStoragePreview();

    alert('삭제 완료');
  }

  // ---------- Init ----------

  function init() {
    initBoardSkeleton();
    createTokens();
    els.dice.innerHTML = dieSVG(1);

    // load saved AI config into UI defaults
    const cfg = loadAiConfig();
    els.autoSave.checked = DEFAULTS.autoSave;

    // start with offline cells; then apply saved state if present
    cells = buildCellsOffline(DEFAULTS.defaultTopic, path.length);
    renderTileLabels(cells);
    placeTokens();
    updScores();
    setTimerText();
    refreshAiStatusPill();
    setPill(els.cellsStatus, '문제: 기본 세트', 'muted');

    // load saved state
    const saved = loadSavedState();
    if (saved) {
      els.autoSave.checked = true;
      applyState(saved);
      logLine('저장된 상태를 불러왔습니다.');
    } else {
      // seed state so export works immediately
      topic = DEFAULTS.defaultTopic;
      els.topicInput.value = topic;
      persistIfAutoSave();
    }

    // bind events
    els.applyTopic.addEventListener('click', onApplyTopic);
    els.startGame.addEventListener('click', startGame);
    els.resetGame.addEventListener('click', resetGame);
    els.rollBtn.addEventListener('click', onRoll);

    els.submitAnswer.addEventListener('click', onSubmitAnswer);
    els.qModal.addEventListener('click', (e) => { if (e.target === els.qModal) showModal(els.qModal, false); });
    els.endModal.addEventListener('click', (e) => { if (e.target === els.endModal) showModal(els.endModal, false); });

    els.autoSave.addEventListener('change', () => persistIfAutoSave());
    els.exportJson.addEventListener('click', onExportJson);
    els.importJson.addEventListener('change', (e) => { onImportJson(e.target.files?.[0]); e.target.value=''; });
    els.clearData.addEventListener('click', onClearData);

    els.openSettings.addEventListener('click', () => openDrawer(true));
    els.closeSettings.addEventListener('click', () => openDrawer(false));
    els.drawer.addEventListener('click', (e) => {
      if (e.target && e.target.classList.contains('drawer__backdrop')) openDrawer(false);
    });

    els.saveAi.addEventListener('click', onSaveAi);
    els.deleteKey.addEventListener('click', onDeleteKey);
    els.testAi.addEventListener('click', onTestAi);

    // reflect saved AI config (even if no game state)
    els.aiMode.value = cfg.mode;
    els.geminiModel.value = cfg.model;
    els.genCount.value = String(cfg.count);
    els.proxyUrl.value = cfg.proxyUrl;

    refreshStoragePreview();
  }

  init();
})();
