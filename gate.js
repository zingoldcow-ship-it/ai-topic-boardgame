(() => {
  'use strict';

  const LS = {
    gateDone: 'TOPIC_BOARDGAME_TEACHER_GATE_DONE_V1',
    passHash: 'TOPIC_BOARDGAME_TEACHER_PASS_HASH_V1',
  };
  const SS = {
    authed: 'TOPIC_BOARDGAME_TEACHER_AUTH_V1',
  };


  const RESET_KEYS = [
    // API key (stored separately from AI config)
    'GEMINI_API_KEY',
    'TOPIC_BOARDGAME_AI_CONFIG_V2',
    'TOPIC_BOARDGAME_AI_CONFIG_V1',
    'TOPIC_BOARDGAME_PACK_V2',
    'TOPIC_BOARDGAME_STATE_V1',
    // Teacher gate / pass / auth
    'TOPIC_BOARDGAME_TEACHER_GATE_DONE_V1',
    'TOPIC_BOARDGAME_TEACHER_PASS_HASH_V1',
    'TOPIC_BOARDGAME_TEACHER_AUTH_V1',
  ];

  const DEFAULT_SETUP_KEY = 'abcd1234';

  const $ = (sel, root=document) => root.querySelector(sel);

  function bytesToHex(buffer){
    return [...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function sha256Hex(str){
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
    return bytesToHex(buf);
  }

  function ensureModal(){
    let modal = $('#teacherGateModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'teacherGateModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="backdrop"></div>
      <div class="panel gate-panel" role="dialog" aria-modal="true" aria-labelledby="gateTitle">
        <div class="row gate-head" style="justify-content:space-between; align-items:center;">
          <h3 id="gateTitle" style="margin:0;">교사용 인증</h3>
          <button class="btn" id="gateCloseBtn" type="button" style="padding:8px 10px;">닫기</button>
        </div>

        <div class="gate-msg" id="gateMsg" style="margin:10px 0 12px; color:var(--muted); font-size:13px; line-height:1.5;"></div>

        <div class="gate-step" data-step="setupKey">
          <label class="label">초기 설정키</label>
          <input id="gateSetupKeyInput" type="password" autocomplete="off" placeholder="초기 설정키를 입력하세요" />
          <div class="row" style="margin-top:10px;">
            <button class="btn primary" id="gateSetupKeyOk" type="button">확인</button>
            <button class="btn" id="gateToPassEnter" type="button">이미 패스코드가 있어요</button>
          </div>
        </div>

        <div class="gate-step" data-step="enterPass" style="display:none;">
          <div class="pin-wrap">
            <div class="pin-display" id="pinDisplay"></div>
            <div class="pin-hint" id="pinHint">6자리 숫자 패스코드를 입력하세요.</div>
          </div>
          <div class="keypad" id="keypad"></div>

          <div class="row" style="margin-top:10px; justify-content:flex-end;">
            <button class="btn primary" id="gatePassOk" type="button">확인</button>
          </div>

          <style>
            #gateResetBtn{ background:#ffe6ee; border-color:#ffd0dd; }
          </style>

          <div class="resetCard" aria-label="관리자 초기화">
            <div class="resetCardTitle">관리자 초기화</div>
            <div class="resetCardDesc">공용 PC에서 다른 선생님이 사용하실 때, 초기화 후 새로 시작하세요.</div>
            <button class="btn" id="gateResetBtn" type="button">초기화</button>
          </div>

          <div class="gate-confirm" id="gateConfirm" aria-hidden="true">
            <div class="gate-confirm__backdrop"></div>
            <div class="gate-confirm__panel" role="dialog" aria-modal="true" aria-labelledby="gateConfirmTitle">
              <h4 id="gateConfirmTitle" style="margin:0 0 8px;">정말 초기화하시겠습니까?</h4>
              <div class="gate-confirm__text">
                초기화하면 <b>교사용 비밀번호</b>, <b>Gemini API 키</b>, <b>설정값</b>이 삭제됩니다.
              </div>
              <div class="row" style="justify-content:flex-end; margin-top:10px;">
                <button class="btn" id="gateConfirmCancel" type="button">취소</button>
                <button class="btn danger" id="gateConfirmOk" type="button">초기화</button>
              </div>
            </div>
          </div>
        </div>

        <div class="gate-step" data-step="setPass1" style="display:none;">
          <div class="pin-wrap">
            <div class="pin-display" id="pinDisplay1"></div>
            <div class="pin-hint">교사용 6자리 숫자 패스코드를 설정하세요.</div>
          </div>
          <div class="keypad" id="keypad1"></div>
          <div class="row" style="margin-top:10px;">
            <button class="btn primary" id="gateSet1Next" type="button">다음</button>
          </div>
        </div>

        <div class="gate-step" data-step="setPass2" style="display:none;">
          <div class="pin-wrap">
            <div class="pin-display" id="pinDisplay2"></div>
            <div class="pin-hint">한 번 더 입력해 확인하세요.</div>
          </div>
          <div class="keypad" id="keypad2"></div>
          <div class="row" style="margin-top:10px; justify-content:space-between;">
            <button class="btn" id="gateSetBack" type="button">뒤로</button>
            <button class="btn primary" id="gateSetDone" type="button">설정 완료</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  function openModal(modal){
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
  }
  function closeModal(modal){
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
  }

  function setBodyLocked(locked){
    if (locked) document.body.classList.add('teacher-locked');
    else document.body.classList.remove('teacher-locked');
  }

  function makePinDisplay(el){
    el.innerHTML = '';
    for (let i=0;i<6;i++){
      const d=document.createElement('div');
      d.className='pin-dot';
      el.appendChild(d);
    }
  }
  function updatePinDisplay(el, pin){
    const dots=[...el.querySelectorAll('.pin-dot')];
    dots.forEach((d,i)=> d.classList.toggle('filled', i < pin.length));
  }

  function buildKeypad(container, handlers){
    const keys = [
      '1','2','3',
      '4','5','6',
      '7','8','9',
      'CLR','0','DEL'
    ];
    container.innerHTML='';
    keys.forEach(k=>{
      const b=document.createElement('button');
      b.type='button';
      b.className='keypad-btn';
      b.textContent = (k==='DEL') ? '⌫' : (k==='CLR' ? 'C' : k);
      b.dataset.key = k;
      b.addEventListener('click', ()=>handlers.onKey(k));
      container.appendChild(b);
    });
  }

  function showStep(modal, step){
    modal.querySelectorAll('.gate-step').forEach(s=>{
      s.style.display = (s.dataset.step===step) ? '' : 'none';
    });
  }

  function getHasPass(){
    return !!localStorage.getItem(LS.passHash);
  }

  async function runGate({ onAuthed, allowClose, startStep } = {}){
    const modal = ensureModal();
    const msg = $('#gateMsg', modal);
    const closeBtn = $('#gateCloseBtn', modal);
    const confirmWrap = $('#gateConfirm', modal);
    const confirmCancel = $('#gateConfirmCancel', modal);
    const confirmOk = $('#gateConfirmOk', modal);

    // close control
    closeBtn.style.display = allowClose ? '' : 'none';

    let step = startStep || (getHasPass() ? 'enterPass' : 'setupKey');
    let pin = '';
    let pin1 = '';
    let pin2 = '';
    let pendingSetupKeyOk = false;
    let isResetFlow = false;

    // init pin UIs
    makePinDisplay($('#pinDisplay', modal));
    makePinDisplay($('#pinDisplay1', modal));
    makePinDisplay($('#pinDisplay2', modal));

    const pinEls = {
      enter: $('#pinDisplay', modal),
      p1: $('#pinDisplay1', modal),
      p2: $('#pinDisplay2', modal),
    };

    function setMsg(text, isError=false){
      msg.textContent = text || '';
      msg.style.color = isError ? '#b91c1c' : 'var(--muted)';
    }

    function openConfirm(){
      if (!confirmWrap) return;
      confirmWrap.classList.add('open');
      confirmWrap.setAttribute('aria-hidden','false');
    }
    function closeConfirm(){
      if (!confirmWrap) return;
      confirmWrap.classList.remove('open');
      confirmWrap.setAttribute('aria-hidden','true');
    }

    function resetPin(){
      pin='';
      updatePinDisplay(pinEls.enter, pin);
    }
    function resetPin1(){
      pin1='';
      updatePinDisplay(pinEls.p1, pin1);
    }
    function resetPin2(){
      pin2='';
      updatePinDisplay(pinEls.p2, pin2);
    }

    function wireKeypad(stepName, containerSel, pinRef){
      const container = $(containerSel, modal);
      buildKeypad(container, {
        onKey: (k)=>{
          if (k === 'DEL'){
            if (pinRef.value.length>0) pinRef.value = pinRef.value.slice(0,-1);
          } else if (k === 'CLR'){
            pinRef.value = '';
          } else if (/^\d$/.test(k)){
            if (pinRef.value.length < 6) pinRef.value += k;
          }
          updatePinDisplay(pinRef.el, pinRef.value);

          // auto-confirm when 6 digits entered
          if (pinRef.value.length === 6){
            if (stepName === 'enterPass') $('#gatePassOk', modal)?.click();
            if (stepName === 'setPass1') $('#gateSet1Next', modal)?.click();
            if (stepName === 'setPass2') $('#gateSetDone', modal)?.click();
          }
        }
      });
    }

    wireKeypad('enterPass', '#keypad', { get value(){return pin;}, set value(v){pin=v;}, el: pinEls.enter });
    wireKeypad('setPass1', '#keypad1', { get value(){return pin1;}, set value(v){pin1=v;}, el: pinEls.p1 });
    wireKeypad('setPass2', '#keypad2', { get value(){return pin2;}, set value(v){pin2=v;}, el: pinEls.p2 });

    function goto(next){
      step = next;
      showStep(modal, next);
      setMsg('');
      if (next==='enterPass'){ resetPin(); }
      if (next==='setPass1'){ resetPin1(); }
      if (next==='setPass2'){ resetPin2(); }
    }

    // default messages per step
    const stepMsg = {
      setupKey: '교사용 기능은 인증이 필요합니다.\n처음 1회, 초기 설정키로 패스코드를 설정하세요.',
      enterPass: '교사용 패스코드를 입력하면 교사용 화면으로 이동합니다.',
      setPass1: '교사용 패스코드를 설정합니다(숫자 6자리).',
      setPass2: '패스코드를 한 번 더 입력해 확인합니다.',
    };

    goto(step);
    setMsg(stepMsg[step] || '');

    // handlers
    $('#gateToPassEnter', modal).onclick = () => {
      isResetFlow = false;
      if (!getHasPass()){
        setMsg('아직 패스코드가 설정되지 않았습니다. 먼저 초기 설정키로 설정을 진행하세요.', true);
        return;
      }
      goto('enterPass');
      setMsg(stepMsg.enterPass);
    };

    $('#gateSetupKeyOk', modal).onclick = async () => {
      const v = ($('#gateSetupKeyInput', modal).value || '').trim();
      if (!v){
        setMsg('초기 설정키를 입력하세요.', true); return;
      }
      if (v !== DEFAULT_SETUP_KEY){
        setMsg('초기 설정키가 올바르지 않습니다.', true); return;
      }

      if (isResetFlow){
        // Clear teacher auth + AI config so a different teacher can start fresh on the same device.
        try {
          localStorage.removeItem(LS.passHash);
          localStorage.removeItem(LS.gateDone);
          RESET_KEYS.forEach(k => localStorage.removeItem(k));
        } catch (e) {}
        try { sessionStorage.removeItem(SS.authed); } catch (e) {}
        isResetFlow = false;
      }

      localStorage.setItem(LS.gateDone, '1');
      goto('setPass1');
      setMsg(stepMsg.setPass1);
    };

    $('#gatePassOk', modal).onclick = async () => {
      if (pin.length !== 6){
        setMsg('6자리 숫자 패스코드를 입력하세요.', true); return;
      }
      const inputHash = await sha256Hex(pin);
      const savedHash = localStorage.getItem(LS.passHash) || '';
      if (!savedHash){
        setMsg('패스코드가 아직 설정되지 않았습니다. 초기 설정키로 먼저 설정하세요.', true);
        goto('setupKey');
        setMsg(stepMsg.setupKey, true);
        return;
      }
      if (inputHash !== savedHash){
        setMsg('패스코드가 올바르지 않습니다.', true);
        resetPin();
        return;
      }
      sessionStorage.setItem(SS.authed, '1');
      isResetFlow = false;
      setBodyLocked(false);
      closeModal(modal);
      onAuthed && onAuthed();
    };

    $('#gateResetBtn', modal).onclick = () => {
      // confirm first (avoid accidental reset)
      openConfirm();
    };

    confirmCancel && (confirmCancel.onclick = () => closeConfirm());
    confirmOk && (confirmOk.onclick = () => {
      closeConfirm();
      try {
        RESET_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
        try { sessionStorage.clear(); } catch (_) {}
      } catch (_) {}

      alert('초기화 완료!\n이 기기의 저장된 비밀번호/설정/API 키/문제 파일을 모두 삭제했습니다.\n\n새로 시작합니다.');
      location.reload();
    });
confirmWrap && confirmWrap.querySelector('.gate-confirm__backdrop')?.addEventListener('click', closeConfirm);

    $('#gateSet1Next', modal).onclick = () => {
      if (pin1.length !== 6){
        setMsg('6자리 숫자 패스코드를 입력하세요.', true); return;
      }
      goto('setPass2');
      setMsg(stepMsg.setPass2);
    };

    $('#gateSetBack', modal).onclick = () => {
      goto('setPass1');
      setMsg(stepMsg.setPass1);
    };

    $('#gateSetDone', modal).onclick = async () => {
      if (pin1.length !== 6 || pin2.length !== 6){
        setMsg('6자리 숫자 패스코드를 입력하세요.', true); return;
      }
      if (pin1 !== pin2){
        setMsg('두 번 입력한 패스코드가 서로 다릅니다. 다시 입력하세요.', true);
        goto('setPass1');
        setMsg(stepMsg.setPass1, true);
        return;
      }
      const h = await sha256Hex(pin1);
      localStorage.setItem(LS.passHash, h);
      sessionStorage.setItem(SS.authed, '1');
      isResetFlow = false;
      setBodyLocked(false);
      closeModal(modal);
      onAuthed && onAuthed();
    };

    closeBtn.onclick = () => {
      if (!allowClose) return;
      closeModal(modal);
      setBodyLocked(false);
    };
    $('.backdrop', modal).onclick = () => {
      if (!allowClose) return;
      closeModal(modal);
      setBodyLocked(false);
    };

    // open
    openModal(modal);
    setBodyLocked(!allowClose); // lock teacher page usage when not allowClose

    return modal;
  }

  const TeacherGate = {
    bindTeacherButton({ buttonSelector='#btnTeacher', teacherUrl='./teacher.html' } = {}){
      const btn = document.querySelector(buttonSelector);
      if (!btn) return;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        runGate({
          allowClose: true,
          onAuthed: () => { window.location.href = teacherUrl; },
        });
      });
    },
    requireAuthOnTeacherPage({ homeUrl='./index.html' } = {}){
      if (sessionStorage.getItem(SS.authed) === '1') return;
      runGate({
        allowClose: false,
        onAuthed: () => {},
      });

      // also inject a small "홈으로" button if needed
      const modal = ensureModal();
      const head = modal.querySelector('.gate-head');
      if (head && !modal.querySelector('#gateHomeBtn')){
        const homeBtn = document.createElement('button');
        homeBtn.id='gateHomeBtn';
        homeBtn.type='button';
        homeBtn.className='btn';
        homeBtn.textContent='🏠 홈';
        homeBtn.style.padding='8px 10px';
        homeBtn.onclick = ()=>{ window.location.href = homeUrl; };
        head.insertBefore(homeBtn, head.lastElementChild); // before close (which is hidden)
      }
    }
  };

  window.TeacherGate = TeacherGate;
})();
