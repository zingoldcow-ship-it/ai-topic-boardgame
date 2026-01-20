/**
 * Cloudflare Worker (무료 플랜 가능) - Gemini 프록시
 *
 * 목적: GitHub Pages 정적 웹앱에서 API 키를 노출하지 않고 Gemini 호출.
 *
 * 배포 절차(요약):
 * 1) Cloudflare -> Workers & Pages -> Create Worker
 * 2) 이 파일 내용을 worker 편집기에 붙여넣고 저장/배포
 * 3) Worker Settings -> Variables -> Add secret: GEMINI_API_KEY
 * 4) (권장) CORS 허용 도메인 제한: ALLOWED_ORIGIN = "https://<user>.github.io"
 *
 * 프론트 설정:
 * - 설정(⚙️) -> AI 생성 모드: "프록시(키 노출 없음)" 선택
 * - 프록시 URL에: https://<worker-subdomain>.workers.dev
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';
    const corsAllow = (allowedOrigin === '*' || allowedOrigin === origin) ? origin : '';

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': corsAllow || '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (url.pathname !== '/generate' || request.method !== 'POST') {
      return new Response('Not Found', { status: 404 });
    }

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return json({ ok: false, error: 'Missing GEMINI_API_KEY secret in Worker.' }, 500, corsAllow);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'Invalid JSON body.' }, 400, corsAllow);
    }

    const topic = String(body.topic || '').trim();
    const count = Number(body.count || 24);
    const model = String(body.model || 'gemini-1.5-flash').trim();

    if (!topic) {
      return json({ ok: false, error: 'Missing topic.' }, 400, corsAllow);
    }

    // 프롬프트는 프론트에서 만들 수 있지만, Worker에서 고정하면 일관성이 좋아집니다.
    const prompt = buildPrompt(topic, count);

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    };

    let resp;
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return json({ ok: false, error: `Upstream fetch failed: ${String(e)}` }, 502, corsAllow);
    }

    const text = await resp.text();
    if (!resp.ok) {
      return json({ ok: false, error: `Upstream error (${resp.status}): ${text.slice(0, 800)}` }, 502, corsAllow);
    }

    // 그대로 프론트에 전달 (프론트에서 JSON array 추출/검증)
    return new Response(text, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': corsAllow || '*',
      },
    });
  },
};

function json(obj, status, corsAllow) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': corsAllow || '*',
    },
  });
}

function buildPrompt(topic, count) {
  return [
    '너는 한국 초등학교 수업용 퀴즈 출제자다.',
    `주제: "${topic}"`,
    `아래 JSON 배열만 출력해라. 원소는 정확히 ${count}개.`,
    '형식: [{"label":"짧은라벨","q":"문제","a":"정답(복수는 |로 구분)"}, ...]',
    '',
    '조건:',
    '- label은 2~8글자 정도(칸에 표시됨).',
    '- q는 한 문장 또는 두 문장(너무 길지 않게).',
    '- a는 짧게(키워드 중심). 필요하면 복수정답을 | 로 구분.',
    '- 난이도는 5학년 수준. 암기형/이해형/적용형이 섞이게.',
    '- OX 문제는 a를 "O" 또는 "X"로.',
    '- 보기(선택지)는 q에 포함 가능하나 JSON 구조는 유지.',
    '',
    '주의: JSON 외의 설명 텍스트를 절대 출력하지 마라.',
  ].join('\n');
}
