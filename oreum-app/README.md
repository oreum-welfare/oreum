# 오름 웹 (React)

시뮬레이터, 데이터 분석, **AI 검수 화면**을 담은 React(Vite) 버전입니다.

| 주소 | 화면 |
|---|---|
| `/` | 복지 절벽 시뮬레이터 |
| `/analysis` | 데이터 분석 (가구 유형 × 지역 12가지) |
| `/review` | AI 검수: 원문과 AI 규칙을 나란히 보고 조건마다 승인·수정·삭제 |

## 실행
```bash
npm install
npm run dev
```
브라우저에서 http://localhost:5173

## 데이터
- `public/data/rules.json`: 규칙·금액 (원본은 `../web/data/rules.json`)
- `public/data/review.json`: AI 검수 데이터 (원본은 `../pipeline/review_export.json`, `python pipeline/export_review.py`로 생성)
- `npm run dev` / `npm run build`가 시작할 때 원본을 자동으로 복사합니다 (`scripts/sync-data.mjs`). 원본이 없는 환경(Vercel)에서는 이미 복사된 파일을 씁니다.

## 구조
| 파일 | 내용 |
|---|---|
| `src/lib/engine.js` | 판정 엔진 (`web/js/engine.js`와 같은 파일, 파이썬 `rules.py`와 결과 일치 확인) |
| `src/pages/Simulator.jsx` | 시뮬레이터 |
| `src/pages/Analysis.jsx` | 데이터 분석 |
| `src/pages/Review.jsx` | AI 검수 화면 (검수 결과는 브라우저에 저장, JSON으로 내보내기) |

## 배포 (Vercel)
Root Directory를 `oreum-app`으로 지정하면 Vite로 자동 인식됩니다. `vercel.json`이 새로고침 시 404를 막아 줍니다.

⚠️ 계산 로직을 바꾸면 `src/lib/engine.js`, `../web/js/engine.js`, `../rules.py`를 함께 바꿔야 합니다.
