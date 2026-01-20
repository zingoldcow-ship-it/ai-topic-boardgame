# 주제형 한바퀴 보드게임 (정적 웹앱)

업로드된 **"정선아리랑 한바퀴 놀이판"**(HTML 1파일) 구조를 유지하면서,

- 주제 입력 → 말판 문제 **전체 교체**
- **2인 턴제**(🔴/🔵), 액션칸, 타이머, 채점 모달
- 문제/설정 **자동저장**, JSON **내보내기/가져오기**, 전체 초기화
- 톱니(⚙️) 설정 패널에서 **AI 생성(선택)** + 데이터 관리

을 추가한 버전입니다.

## 1) GitHub Pages 배포(무료, 잠김 없음)

1. 새 GitHub 리포지토리 생성
2. `index.html`, `styles.css`, `app.js` 3개 파일을 리포지토리 루트에 업로드
3. GitHub → Settings → Pages → Source: `Deploy from a branch` → Branch: `main` (또는 `master`), folder: `/(root)`
4. 배포된 URL로 접속

## 2) AI 생성은 2가지 모드

### A) 브라우저 직접 호출(키가 브라우저에 저장됨)
- 설정(⚙️) → AI 생성 모드: **브라우저 직접 호출**
- Gemini API 키 입력 후 저장
- 장점: 서버 없음(완전 정적), GitHub Pages만으로 동작
- 단점: 키가 브라우저/DevTools에서 노출될 수 있음
- 권장 보완: Google에서 키에 **HTTP referrers** 제한(내 GitHub Pages 도메인만 허용)

### B) 프록시(키 노출 없음, 권장)
- GitHub Pages + Cloudflare Worker(무료) 조합
- API 키는 Worker에 Secret으로만 저장 → 브라우저에 전달되지 않음

#### Cloudflare Worker 배포
1. Cloudflare → Workers & Pages → Create Worker
2. Worker 코드에 `worker.js` 내용 붙여넣기
3. Settings → Variables → **Secrets** → `GEMINI_API_KEY` 추가
4. (권장) Variables → `ALLOWED_ORIGIN`에 GitHub Pages 도메인(예: `https://<id>.github.io`) 설정
5. 배포 후 URL 확인: `https://<worker>.workers.dev`
6. 웹앱 설정(⚙️)에서
   - AI 생성 모드: **프록시(키 노출 없음)**
   - 프록시 URL: `https://<worker>.workers.dev`

## 3) 데이터 저장/삭제
- 자동 저장: 주제 적용/AI 생성 시 localStorage에 저장
- JSON 내보내기: `TOPIC_BOARDGAME_STATE_V1` 포함 상태를 파일로 다운로드
- JSON 가져오기: 내보낸 파일을 업로드하면 그대로 복원
- API 키 삭제: 설정(⚙️) → **API 키 삭제**
- 전체 초기화: 설정(⚙️) → 데이터 관리 → **모든 데이터 삭제**

## 4) 문제 생성 규칙
- 말판의 액션칸(쉬기, 이동)은 고정
- 나머지 칸은 문제칸(라벨/질문/정답)로 채움
- 정답은 `|`로 복수 허용 (예: `강원도|강원특별자치도`)

