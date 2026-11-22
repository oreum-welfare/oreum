# 🟦 오름 — AI 기반 복지 절벽 탐지·자립경로 시뮬레이터

> 월급이 오르면, 생활비도 오를까? 소득이 조금 늘 때 어떤 복지 혜택이 언제 한꺼번에 사라지는지 보여주는 웹 서비스
> 2026 사회보장 데이터를 활용한 AI 혁신 아이디어 경진대회 출품작

- 배포 URL: https://oreum-theta.vercel.app (관리자 화면: `/admin/analysis`)
- 분석 결론·인사이트·제안 아이디어: [analysis/INSIGHTS.md](analysis/INSIGHTS.md)
- 데이터 출처(URL·기준일)와 근거 확인표: [data/sources](data/sources/README.md)
- 시연 영상: (YouTube 링크 기입)

## 주제
복지로 선정기준 원문을 판정 규칙으로 바꿔서, 가구의 소득·지역이 바뀔 때 받는 혜택이 어떻게 변하는지 계산하고
**"소득이 늘었는데 쓸 수 있는 돈은 줄어드는 구간(복지 절벽)"** 을 찾아냅니다.

## 주제 선택 이유
- 수급자가 취업·소득 증가를 망설이는 '탈수급 유인' 문제
- 현금 급여는 서서히 줄지만, 수급 자격에 묶인 정액·감면 혜택은 기준선에서 한꺼번에 끊김
- 같은 소득이어도 사는 지역에 따라 혜택이 다름

## 데이터 분석 내용
- **중앙 제도 12개는 전국 시군구 230곳**에서 계산 (지역별 급지·기본재산액·주거용재산 한도·기초연금 공제는 고시 기준, [regions.csv](data/sources/regions.csv))
- **지자체 제도는 담당자가 승인한 것만** 계산 (지금: 대구 북구 1, 경산시 4). AI 초안 30건(경산·대구 북구·영천)은 관리자 화면에서 해당 지자체 담당자가 검토
- 2026년 기준 제도의 선정기준·금액을 `rules.json`에 정리. 숫자 30개마다 근거 URL·기준일·확인 상태를 [수치 확인표](data/sources/value_checks.csv)에 기록
- 대표 가구 6개 × 2개 지역 = 12가지 경우 모두에서 절벽 발견, 총 **53곳**. 가장 큰 절벽은 **노인 부부, 월소득 681만 원에서 월 560,520원 감소** (기초연금 종료), 한부모 + 자녀 2명은 498만 원에서 450,204원 (아동양육비 종료)
- 혜택 종료 106건 중 28건이 **근로소득 기준 중위소득 70~75%**에 몰림 (중위 50% 기준 혜택들이 근로소득공제 30% 때문에 실제 소득 약 71%에서 한꺼번에 끊김)
- 제도 개선 시뮬레이션: 혜택을 기준선 위 중위 10%p 구간에서 서서히 줄이면 절벽 53개 → 16개, 가장 큰 절벽 560,520원 → 7,277원
- AI 규칙 변환: GPT-5가 복지로 원문을 판정 규칙으로 변환. 학습용 13건 85%, 처음 보는 14건 36% → 원인 분석 후 3차 프롬프트로 처음 보는 16건 81% ([결과](pipeline/RESULTS.md))
- 결론과 인사이트, 경진대회 제안 아이디어: [analysis/INSIGHTS.md](analysis/INSIGHTS.md)

## 파일 구조
| 파일 | 설명 |
|---|---|
| `oreum-web/` | **React 웹 앱**: 국민용 계산기(`/`) + 관리자 화면(`/admin`: 데이터 분석, AI 성능, AI 검수, 지자체 제도 검토) |
| `data/build_regions.py` | 전국 시군구 목록(`data/sources/regions.csv`)으로 지역별 기준값을 `rules.json`에 만든다 |
| `pipeline/export_local_drafts.py` | AI 변환 결과를 지자체 제도 '검토 대기' 초안(`pipeline/local_drafts.json`)으로 내보낸다 |
| `supabase/` | 담당자 로그인·지역별 권한(행 단위 보안)·승인 이력 DB 설정 ([안내](supabase/README.md)) |
| `oreum-web/src/lib/engine.js` | 판정 엔진 (JavaScript, 브라우저에서 계산) |
| `data/rules.json` | **규칙·금액·근거 데이터. 앱과 분석이 함께 읽는 단 하나의 파일** |
| `rules.py` | 판정 엔진 (파이썬, 데이터 분석용). `data/rules.json`을 읽음 |
| `analysis/` | 가구 유형별 절벽 분석 (CSV 출력) |
| `pipeline/` | **AI 변환 파이프라인**: 원문 → GPT-5(또는 Claude) → 규칙 JSON → 정답과 비교해 정확도 ([안내](pipeline/README.md), [결과](pipeline/RESULTS.md)) |
| `tests/` | 엔진 일치 검사(JS↔파이썬), 엔진 기대값 검사, AI 채점기 검사. PR마다 CI가 자동 실행 |
| `assets/logo.html` | 로고 미리보기와 PNG 다운로드 |

> **금액을 바꿀 때:** `data/rules.json`만 고치면 앱과 분석에 함께 반영됩니다. 같은 항목의 `verification`(근거·확인 상태)도 고쳐 주세요.
> **계산 방식을 바꿀 때:** `oreum-web/src/lib/engine.js`와 `rules.py`를 똑같이 고친 뒤 `python tests/parity_py.py && node tests/parity.mjs`(일치 검사)와 `node tests/engine_checks.mjs`(기대값 검사)로 확인합니다.
> **AI 채점기를 바꿀 때:** `python tests/grader_checks.py`로 틀린 답을 오답으로 잡는지 확인합니다.

## 내 컴퓨터에서 실행
```bash
cd oreum-web
npm install
npm run dev
```
브라우저에서 http://localhost:5173 (관리자 화면: /admin) 접속

## Vercel 배포
1. GitHub 팀 저장소에 이 폴더 전체를 push
2. Vercel → **Add New → Project** → 저장소 Import
3. **Root Directory: `oreum-web`** (Framework Preset은 Vite로 자동 인식, Build `npm run build`, Output `dist`)
4. Deploy → `프로젝트이름.vercel.app`

> 규칙·AI 결과를 바꿨다면 push 전에 `oreum-web` 폴더에서 `npm run sync-data`를 실행해 `public/data/`를 최신으로 만드세요.

## 데이터 분석
- 분석 대상 지역은 `rules.json`의 `analysis_regions`(대구 북구·경산시)로 고정돼 있어, 전국 지역을 추가해도 제안서 분석 결과(절벽 53곳)는 그대로입니다.
- **웹:** 관리자 화면의 '데이터 분석' 페이지 (`/admin/analysis`) — 핵심 발견, 가구 유형 × 지역 절벽 요약표, 곡선 비교, 혜택 종료 구간 분포, '10만 원 더 벌면' 분석
- **파이썬:** 같은 분석을 CSV로 저장 (가구 유형은 `rules.json`의 `analysis_households`)
```bash
pip install -r requirements.txt
python analysis/cliff_analysis.py
```
결과: `analysis/output/cliff_summary.csv`, `analysis/output/benefit_endings.csv` (Excel 판: `python data/sources/build_tables.py`로 같은 폴더에 생성)

## 데이터 출처
전체 목록(22개)·기준일·확인 방법은 [data/sources](data/sources/README.md)에 CSV와 Excel로 있습니다. 적용 기준은 **2026년**(2026-01-01 시행), API 수집일은 **2026-11-14**입니다.

| 데이터 | 제공기관 | URL |
|---|---|---|
| 중앙부처복지서비스 API | 한국사회보장정보원 | https://www.data.go.kr/data/15090532/openapi.do |
| 지자체복지서비스 API | 한국사회보장정보원 | https://www.data.go.kr/data/15108347/openapi.do |
| 2026년 기준 중위소득 및 생계·의료급여 선정기준 (고시 제2025-135호) | 보건복지부 | https://www.law.go.kr/행정규칙/2026년기준중위소득및생계·의료급여선정기준과최저보장수준 |
| 2026년 주거급여 선정기준 및 최저보장수준 (고시 제2025-506호) | 국토교통부 | https://www.law.go.kr/행정규칙/2026년주거급여선정기준및최저보장수준 |
| 2026년 국민기초생활보장사업안내 | 보건복지부 | https://www.data.go.kr/data/15089718/fileData.do |
| 대구 북구·경산시 조례 (건강보험료 지원, 출산장려, 다자녀, 생활안정자금 등) | 각 지자체 | [sources.csv](data/sources/sources.csv) S14~S18 |

## 지자체 제도: 담당자 승인과 권한
- 계산기에는 `status`가 **승인**인 지자체 제도만 들어갑니다. AI 초안은 '검토 대기'로 들어와 계산되지 않습니다.
- 관리자 화면 **지자체 제도 검토**(`/admin/local`)에서 담당자는 **자기 지자체 제도만** 보고 원문과 대조해 승인·반려합니다.
- 계산기 입력으로 표현할 수 없는 문장 조건은 담당자가 '신청할 때 확인'으로 두면 계산에서 빼고 결과에 안내합니다. 계산하는 조건이 하나도 없으면 승인할 수 없습니다.
- 기본은 **데모 모드**(데모 계정, 결정은 브라우저에만 저장, 권한 검사도 화면에서만)입니다. 실제 운영은 [Supabase 설정](supabase/README.md)으로 로그인과 DB 권한(RLS)을 켭니다.
- 검사: `node tests/admin_checks.mjs` (권한·상태 규칙)

## 협업 방법
- 브랜치: 작업 브랜치 → `develop`(기본) → `main`(발표·제출 버전). `develop`과 `main`에는 PR로만 합칩니다.
- 이슈 템플릿(기능 / 버그 / 데이터), PR 템플릿, 커밋 규칙: [CONTRIBUTING.md](CONTRIBUTING.md)

## 팀원 소개
| 이름 | 역할 |
|---|---|
| (이름) | 데이터 분석 · 발표 · 서류 제출 |
| (이름) | UI · 배포 |
| (이름) | 코드 검증 · 서류 검토 |
