# AI Design & Website Auditor

> Analyze your website. Understand the problems. Improve the experience.

URL 하나를 입력하면 실제 페이지를 수집하고, 50여 개의 근거 기반 규칙 체크와 AI 검토를 결합해 **점수 → 이슈 → 원인 → 개선안 → 우선순위 → 리포트 → 개선 추적**까지 제공하는 웹사이트 감사 SaaS의 MVP입니다.

---

## 아키텍처

```
Browser (index.html · SPA · PWA)
   │  POST {url, lang}  ← Authorization: 사용자 JWT
   ▼
Supabase Edge Function  /functions/v1/audit      (로컬: server/dev-server.mjs → /api/audit)
   │  인증 확인 → 요금제 한도 확인 → SSE 스트림 시작
   ▼
audit-core (공용 순수 JS · Deno/Node 동일 코드)
   01 fetch          URL 정규화, SSRF 방어, robots.txt 준수, 리디렉션 재검증
   02 structure      HTML 파싱 → signals(제목·헤딩·내비·CTA·폼·이미지·JSON-LD…),
                     외부 CSS·sitemap·이미지 용량 수집, JS 렌더링 사이트 감지
   03 visual         CSS 지표(서체·색·반경·브레이크포인트·대비쌍), 스크린샷(선택)
   04 ux / 05 a11y   규칙 엔진(rules.js) — 관찰된 근거 + 이슈/강점
   06 recommendations AI 엔진 1회 호출(모듈식 프롬프트 + JSON Schema 강제) → 검증
   07 report         가중 점수 계산, 신뢰도, 이슈 정렬, 요약, 캐시 저장
   ▼
Supabase DB: audits · audit_categories · audit_issues · reports · ai_usage · audit_cache
```

- **AI Answer가 아닌 AI Audit**: AI는 규칙 엔진이 이미 찾은 항목을 받아 중복 없이 질적 판단만 추가합니다. 결과는 스키마 검증을 통과해야만 반영됩니다.
- **Observed / Inferred / Recommended 구분**: 모든 이슈에 `evidence.type`(observed/inferred), `evidence.detail`, `confidence`가 붙습니다. 스크린샷이 없으면 시각 판단의 신뢰도를 자동으로 낮춥니다.
- **점수는 임의 숫자가 아님**: `weights.js`의 `AUDIT_WEIGHTS`
  - `blend` — 카테고리별 규칙 점수 : AI 점수 비율 (예: SEO 0.9 : 0.1, Visual 0.25 : 0.75)
  - `aiDimensions` — AI가 매기는 하위 항목과 가중치 (예: UX = user_flow, navigation, cognitive_load…)
  - `overall` — 종합 점수에서 각 카테고리의 비중
  - 관리자는 재배포 없이 `app_settings` 테이블의 `audit_weights` 행(JSON)으로 일부만 덮어쓸 수 있습니다.
- **AI 미연결 시(Mock Adapter)**: 가짜 결과를 만들지 않습니다. 규칙 체크만으로 점수를 내고, 시각·브랜드처럼 AI가 필요한 영역은 “측정 안 됨”으로 표시합니다.

## 1. 파일 구조

```
ai-design-auditor/
├─ index.html                 SPA 전체(랜딩·분석·대시보드·리포트·인증·설정) + 디자인 시스템 + i18n(EN/KO)
├─ manifest.webmanifest, sw.js, icon.svg, icon-maskable.svg   PWA (오프라인 셸만 캐시)
├─ _redirects, vercel.json    SPA 라우팅(/audit/:id 등) 리라이트
├─ assets/sample/             샘플 리포트(JSON)와 데모 사이트 스크린샷
├─ demo-site/                 샘플 리포트용 데모 웹사이트 (의도적 결함 포함)
├─ server/dev-server.mjs      로컬 개발 서버 — 무의존성, 같은 audit-core 사용
├─ scripts/
│  ├─ generate-sample.mjs     실제 파이프라인으로 샘플 리포트 생성 → index.html에 삽입
│  └─ sample-ai.json          샘플용 AI 분석(영/한) — 스키마 검증 거쳐 사용
└─ supabase/
   ├─ schema.sql              테이블·RLS·트리거·뷰·스토리지 버킷
   ├─ config.toml             함수 JWT 설정 조각
   └─ functions/
      ├─ audit/index.ts       Edge Function: 인증·한도·SSE·저장·캐시·AI 사용량 기록
      └─ _shared/audit-core/
         ├─ pipeline.js       7단계 오케스트레이션, 점수·리포트 조립
         ├─ fetcher.js        안전한 수집기(SSRF, robots, 타임아웃, 용량 제한)
         ├─ parse.js          무의존성 HTML/CSS 파서, 대비 계산
         ├─ extract.js        signals 추출
         ├─ rules.js          규칙 체크(영/한 문구, 근거, 신뢰도)
         ├─ prompts.js        AUDIT_SYSTEM_PROMPT + 카테고리별 프롬프트 모듈 + 응답 스키마
         ├─ ai.js             AI_ENGINE 어댑터(claude/openai/gemini/mock) + 응답 검증
         ├─ weights.js        AUDIT_WEIGHTS
         └─ plans.js          PLANS (요금제·한도·기능 플래그)
```

## 2. 바로 실행 (로컬 모드, Supabase 없이)

```bash
cp .env.example .env          # AI_ENGINE=mock 이면 규칙 기반만으로 동작
node server/dev-server.mjs    # http://localhost:8787
```

- 실제 URL을 입력하면 실제로 수집·분석합니다. 기록은 브라우저(localStorage)에 저장되고 재감사 비교도 동작합니다.
- 데모 사이트 감사: `.env`에 `ALLOW_PRIVATE_HOSTS=1` 설정 후 `http://localhost:8787/demo-site/` 입력.
- Node 18 이상만 필요합니다(설치할 패키지 없음).

## 3. AI API 설정

`.env`(로컬) 또는 Supabase secrets(프로덕션)에 설정합니다. **키는 절대 index.html에 넣지 않습니다.**

| 엔진 | 설정 |
|---|---|
| Claude | `AI_ENGINE=claude` `AI_API_KEY=sk-ant-…` (기본 모델 `claude-sonnet-5`, tool use로 JSON 강제) |
| OpenAI | `AI_ENGINE=openai` `AI_API_KEY=sk-…` (json_schema response_format) |
| Gemini | `AI_ENGINE=gemini` `AI_API_KEY=…` (responseMimeType JSON) |

- `AI_MODEL`로 모델 변경, `AI_VISION=false`면 스크린샷을 보내지 않습니다.
- 스크린샷: 캡처 API(예: ScreenshotOne, Urlbox 등)의 URL을 `SCREENSHOT_URL_TEMPLATE`에 `{url}`, `{width}`, `{height}` 자리표시자로 넣으면 데스크톱(1440)·모바일(390) 두 장을 찍어 AI에 전달하고 리포트에 “시각적 근거”로 표시합니다.
- JS 렌더링 사이트: `RENDER_URL_TEMPLATE`에 프리렌더 서비스(`{url}` → 렌더된 HTML)를 넣으면 초기 HTML이 비어 있을 때 자동 사용합니다.
- 새 엔진 추가: `ai.js`의 `adapters`에 `analyze({system,user,images,schema}) → {data, usage}`를 구현하면 끝입니다.

## 4. Supabase 설정

1. 프로젝트 생성 → **SQL Editor**에서 `supabase/schema.sql` 전체 실행
   (profiles 자동 생성 트리거, RLS, `my_monthly_usage` 뷰, `screenshots` 공개 버킷 포함)
2. **Authentication → Providers**: Email 활성화, Google 활성화(Google Cloud OAuth 클라이언트 ID/Secret 입력)
3. **Authentication → URL Configuration**: Site URL = 배포 도메인, Redirect URLs에 `https://도메인/**` 추가
4. `index.html` 상단 `AUDITOR_CONFIG`에 공개 값 입력:
   ```js
   SUPABASE_URL: 'https://xxxx.supabase.co',
   SUPABASE_ANON_KEY: 'eyJ…',   // anon 키는 공개용
   ```
5. Edge Function 배포:
   ```bash
   supabase login
   supabase link --project-ref <project-ref>
   supabase secrets set AI_ENGINE=claude AI_API_KEY=sk-ant-... ANON_SALT=$(openssl rand -hex 16) ALLOWED_ORIGINS=https://your-domain.com
   supabase functions deploy audit --no-verify-jwt
   ```
   `--no-verify-jwt`인 이유: 비로그인 체험(하루 1회, IP 해시 기준)을 허용하기 위해 함수가 JWT를 직접 검증합니다.
6. 요금제 변경(결제 연동 전): SQL Editor에서
   `update profiles set plan = 'pro' where email = 'user@example.com';`
   (클라이언트는 트리거로 plan/role을 바꿀 수 없습니다)

## 5. Database 개요

| 테이블 | 용도 |
|---|---|
| `profiles` | 사용자(이름·이메일·plan·role·locale). auth.users 가입 시 자동 생성 |
| `websites` | 사용자별 URL (재감사 비교의 기준) |
| `audits` | 감사 실행 기록(점수·상태·오류 코드·스코어링/프롬프트 버전·엔진) |
| `audit_categories` / `audit_issues` | 정규화된 결과 — 관리자 통계·검색용 |
| `reports` | 전체 리포트 JSON, `is_public`으로 공유 링크 |
| `audit_cache` | URL+버전+언어+요금제+엔진 해시 키로 12시간 캐시 → AI 비용 절감 |
| `anon_usage` / `ai_usage` | 비로그인 제한, 토큰·추정 비용 기록 |
| `prompt_versions` / `app_settings` | 관리자 기능 대비(프롬프트 버전, 가중치 덮어쓰기) |

## 6. 환경 변수

| 이름 | 위치 | 설명 |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | index.html `AUDITOR_CONFIG` | 공개 값 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Edge Function | 자동 주입 |
| `AI_ENGINE`, `AI_API_KEY`, `AI_MODEL`, `AI_VISION` | 서버 | AI 엔진 |
| `AI_PRICE_INPUT_PER_MTOK`, `AI_PRICE_OUTPUT_PER_MTOK` | 서버 | 비용 추정용 단가 |
| `SCREENSHOT_URL_TEMPLATE`, `RENDER_URL_TEMPLATE` | 서버 | 선택 캡처 서비스 |
| `RESPECT_ROBOTS` | 서버 | 기본 true |
| `ALLOW_PRIVATE_HOSTS` | 서버 | 로컬 테스트용, 프로덕션에서는 0 |
| `ANON_SALT`, `AUDIT_CACHE_HOURS`, `ALLOWED_ORIGINS` | Edge Function | 보안·캐시·CORS |
| `PORT`, `DEV_TIER` | 로컬 서버 | 포트, 시뮬레이션 요금제 |

## 7. 배포

정적 파일(루트 전체)을 아무 정적 호스팅에 올리고, 함수는 Supabase에 배포합니다.

- **Cloudflare Pages / Netlify**: 빌드 없음, 출력 디렉터리 = 루트. `_redirects`가 SPA 라우팅 처리
- **Vercel**: `vercel.json` 리라이트 포함
- 배포 후 확인: `/sample` 표시 → 회원가입 → URL 감사 → `/audits`에 기록 → 같은 URL 재감사 시 비교 표시

샘플 리포트 재생성(규칙·가중치를 바꾼 뒤): `node scripts/generate-sample.mjs`

## 8. 요금제·가중치·프롬프트 변경

- 요금제/한도: `supabase/functions/_shared/audit-core/plans.js` (서버 기준) + `index.html`의 `PLANS`(표시용)
- 점수 가중치: `weights.js` 또는 DB `app_settings('audit_weights')`
- 프롬프트: `prompts.js`의 `AUDIT_*_PROMPT` 모듈을 개별 수정 후 `PROMPT_VERSION` 올리기(캐시 자동 무효화)
- 규칙 추가: `rules.js`에 `{ id, cat, w, run(ctx) }` 한 항목 추가

## 9. 향후 확장 경로

| 단계 | 연결 지점 |
|---|---|
| Phase 2 AI Redesign | 리포트의 `redesign: null` 필드와 이슈의 `view`/스크린샷에 `{current, recommended}` 부착 |
| Phase 3 Design System Generator | `technical.fonts/colors`, CSS 지표를 입력으로 토큰 생성 |
| Phase 4 Landing Page Generator | 리포트의 `summary.priorities` + 콘텐츠 이슈를 프롬프트로 |
| Phase 5 Competitor Analysis | 같은 `runAudit`을 URL 여러 개에 실행 후 카테고리·이슈 diff |
| Phase 6 Continuous Monitoring | pg_cron → `websites` 순회 → 함수 호출(서비스 키), `audits` 시계열이 이미 비교 구조 |
| Phase 7 Agency / Client | `profiles.role`, `reports.is_public`, 화이트라벨은 `AUDITOR_CONFIG.BRAND_NAME` + 테마 토큰 |
| 결제 | Stripe Checkout → webhook(Edge Function)에서 `profiles.plan` 갱신 |
| 관리자 대시보드 | `ai_usage`(비용), `audits`(실패 코드 분포), `prompt_versions`, `app_settings` |
| 다국어 추가 | `index.html`의 `I18N`에 `ja`, `zh` 등 키 추가 + `rules.js` 문구 배열 확장 |

## 한계 (정직하게)

- 서버에서 HTML을 가져오므로 로그인 뒤 페이지·봇 차단 사이트는 감사할 수 없습니다(오류 코드로 안내).
- 색 대비는 CSS에 선언된 색 쌍 기준이라 이미지 위 텍스트 등은 AI+스크린샷 검토에 의존합니다.
- 응답 시간은 감사 서버 기준 1회 측정값이며, 실제 사용자 성능(Core Web Vitals)은 아닙니다.
