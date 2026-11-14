# 🟦 오름 — AI 기반 복지 절벽 탐지·자립경로 시뮬레이터

> 월급이 오르면, 생활비도 오를까? 소득이 조금 늘 때 어떤 복지 혜택이 언제 한꺼번에 사라지는지 보여주는 웹 서비스
> 2026 사회보장 데이터를 활용한 AI 혁신 아이디어 경진대회 출품작

- 배포 URL: (Vercel 배포 후 기입)
- 시연 영상: (YouTube 링크 기입)

## 주제
복지로 선정기준 원문을 판정 규칙으로 바꿔서, 가구의 소득·지역이 바뀔 때 받는 혜택이 어떻게 변하는지 계산하고
**"소득이 늘었는데 쓸 수 있는 돈은 줄어드는 구간(복지 절벽)"** 을 찾아냅니다.

## 주제 선택 이유
- 수급자가 취업·소득 증가를 망설이는 '탈수급 유인' 문제
- 현금 급여는 서서히 줄지만, 수급 자격에 묶인 정액·감면 혜택은 기준선에서 한꺼번에 끊김
- 같은 소득이어도 사는 지역에 따라 혜택이 다름

## 데이터 분석 내용
- 2026년 기준 제도 17개(중앙 12, 대구 북구·경산시 5)의 선정기준·금액을 공식 고시·사업안내·조례로 확인해 `rules.json`에 정리 (항목마다 근거·확인 상태 표기)
- 대표 가구 6개 × 2개 지역 분석: 가장 큰 절벽은 **한부모 + 자녀 2명, 월소득 498만 원에서 월 450,204원 감소** (아동양육비 종료)
- 혜택 종료 96건 중 28건이 **기준중위소득 70~75%**에 몰림 (중위 50% 기준 혜택들이 근로소득공제 30% 때문에 실제 소득 약 71%에서 한꺼번에 끊김)
- 제도 개선 시뮬레이션: 혜택을 기준선 위 중위 10%p 구간에서 서서히 줄이면 절벽 41개 → 16개, 가장 큰 손해 45만 → 0.7만 원
- AI 규칙 변환: GPT-5가 복지로 원문을 판정 규칙으로 변환. 학습용 13건 85%, 처음 보는 14건 36% → 원인 분석 후 3차 프롬프트로 처음 보는 16건 81% ([결과](pipeline/RESULTS.md))
- 자세한 내용: 데이터 분석 문서 (데이터 출처·수집·활용)

## 파일 구조
| 파일 | 설명 |
|---|---|
| `oreum-app/` | **React 웹 앱**: 시뮬레이터 + 데이터 분석 + AI 검수 화면 ([안내](oreum-app/README.md)) |
| `oreum-app/src/lib/engine.js` | 판정 엔진 (JavaScript, 브라우저에서 계산) |
| `data/rules.json` | **규칙·금액·근거 데이터. 앱과 분석이 함께 읽는 단 하나의 파일** |
| `rules.py` | 판정 엔진 (파이썬, 데이터 분석용). `data/rules.json`을 읽음 |
| `analysis/` | 가구 유형별 절벽 분석 (CSV 출력) |
| `pipeline/` | **AI 변환 파이프라인**: 원문 → GPT-5(또는 Claude) → 규칙 JSON → 정답과 비교해 정확도 ([안내](pipeline/README.md), [결과](pipeline/RESULTS.md)) |
| `tests/` | JS 엔진과 파이썬 엔진의 계산 일치 검사. PR마다 CI가 자동 실행 |
| `assets/logo.html` | 로고 미리보기와 PNG 다운로드 |
| `docs/` | [기획안](docs/01_기획안.md), [PRD](docs/02_PRD.md), [기능명세서](docs/03_기능명세서.md), [제안서 초안](docs/04_제안서_초안.md) |

> **금액을 바꿀 때:** `data/rules.json`만 고치면 앱과 분석에 함께 반영됩니다. 같은 항목의 `verification`(근거·확인 상태)도 고쳐 주세요.
> **계산 방식을 바꿀 때:** `oreum-app/src/lib/engine.js`와 `rules.py`를 똑같이 고친 뒤 `python tests/parity_py.py && node tests/parity.mjs`로 확인합니다.

## 내 컴퓨터에서 실행
```bash
cd oreum-app
npm install
npm run dev
```
브라우저에서 http://localhost:5173 접속

## Vercel 배포
1. GitHub 팀 저장소에 이 폴더 전체를 push
2. Vercel → **Add New → Project** → 저장소 Import
3. **Root Directory: `oreum-app`** (Framework Preset은 Vite로 자동 인식, Build `npm run build`, Output `dist`)
4. Deploy → `프로젝트이름.vercel.app`

> 규칙·AI 결과를 바꿨다면 push 전에 `oreum-app` 폴더에서 `npm run sync-data`를 실행해 `public/data/`를 최신으로 만드세요.

## 데이터 분석
- **웹:** React 앱의 '데이터 분석' 페이지 (`/analysis`) — 핵심 발견, 가구 유형 × 지역 절벽 요약표, 곡선 비교, 혜택 종료 구간 분포, '10만 원 더 벌면' 분석
- **파이썬:** 같은 분석을 CSV로 저장 (가구 유형은 `rules.json`의 `analysis_households`)
```bash
pip install -r requirements.txt
python analysis/cliff_analysis.py
```
결과: `analysis/output/cliff_summary.csv`, `analysis/output/benefit_endings.csv`

## 데이터 출처
- 복지로 복지서비스 상세 (bokjiro.go.kr), 2026년 기준
- 한국사회보장정보원 중앙부처·지자체 복지서비스 정보 (공공데이터포털)

## 협업 방법
- 브랜치: 작업 브랜치 → `develop`(기본) → `main`(발표·제출 버전). `develop`과 `main`에는 PR로만 합칩니다.
- 이슈 템플릿(기능 / 버그 / 데이터), PR 템플릿, 커밋 규칙: [CONTRIBUTING.md](CONTRIBUTING.md)

## 팀원 소개
| 이름 | 역할 |
|---|---|
| (이름) | 데이터 분석 · 발표 · 서류 제출 |
| (이름) | UI · 배포 |
| (이름) | 코드 검증 · 서류 검토 |
