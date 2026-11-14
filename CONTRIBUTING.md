# 개발 규칙

## 1. 브랜치

```
작업 브랜치 ──PR──▶ develop (기본 브랜치) ──PR──▶ main (발표·제출·배포 버전)
```

| 브랜치 | 용도 | 직접 push |
|---|---|---|
| `main` | 발표·제출·배포에 쓰는 안정 버전 | 금지 (develop에서 PR로만) |
| `develop` | 기본 브랜치. 모든 작업이 모이는 곳 | 금지 (작업 브랜치에서 PR로만) |
| 작업 브랜치 | 이슈 하나당 하나 | 자유 |

### 작업 브랜치 이름
`종류/짧은-설명` (영문 소문자, 하이픈)

| 종류 | 언제 | 예 |
|---|---|---|
| `feat/` | 새 기능 | `feat/cliff-guide` |
| `fix/` | 버그 수정 | `fix/chart-tooltip` |
| `design/` | 화면·스타일만 | `design/simulator-layout` |
| `data/` | rules.json 금액·기준 | `data/disability-pension` |
| `ai/` | AI 파이프라인 | `ai/prompt-v3` |
| `docs/` | 문서·발표 자료 | `docs/readme` |

## 2. 작업 순서

1. **이슈 만들기:** GitHub Issues에서 템플릿(기능 / 버그 / 데이터)을 골라 작성하고, 담당자를 지정합니다.
2. **브랜치 만들기:** 항상 최신 develop에서 시작합니다.
   ```bash
   git switch develop
   git pull
   git switch -c feat/cliff-guide
   ```
3. **커밋하고 올리기**
   ```bash
   git add .
   git commit -m "feat: 절벽 넘기 안내 카드 추가"
   git push -u origin feat/cliff-guide
   ```
4. **PR 만들기:** 받는 브랜치를 `develop`으로 두고, 템플릿 체크리스트를 채웁니다. 본문에 `closes #이슈번호`를 쓰면 합칠 때 이슈가 자동으로 닫힙니다.
5. **리뷰:** 팀원 1명이 승인하고 CI(자동 검사)가 통과하면 **Squash and merge**로 합칩니다. 합친 뒤 작업 브랜치는 삭제합니다.

### develop → main
발표·제출·배포 전에 develop을 main으로 합칩니다. PR 제목은 `release: 11/24 발표 버전`처럼 씁니다. 이때는 **Create a merge commit**으로 합칩니다.

## 3. 커밋 메시지

`종류: 무엇을 했는지` (한국어 가능, 50자 이내)

```
feat: 장애인연금 계산 추가
fix: 경산 다자녀 거주기간 조건 오류 수정
design: 시뮬레이터 입력 폼 2단 배치
data: 2026 문화누리카드 금액 15만 원 반영
ai: 판정 불가 규칙 프롬프트 보강
docs: 데이터 분석 문서 링크 추가
```

## 4. 영역별 규칙

### 화면 (`oreum-app/src/pages`, `components`, `styles.css`)
- 계산은 `src/lib/engine.js`가 합니다. 화면 작업에서는 엔진을 고치지 않습니다.
- `oreum-app/public/data/`는 빌드할 때 자동으로 덮어써지므로 직접 고치지 않습니다.

### 계산 엔진
- **세 곳을 항상 똑같이 고칩니다:** `web/js/engine.js`, `oreum-app/src/lib/engine.js`(같은 파일 복사본), `rules.py`
- 고친 뒤 일치 검사를 실행합니다. PR을 올리면 CI가 같은 검사를 다시 합니다.
  ```bash
  python tests/parity_py.py
  node tests/parity.mjs
  ```

### 데이터 (`web/data/rules.json`)
- 금액·기준을 바꾸면 같은 항목의 `verification`(값, 확인 상태, 근거)도 같이 고칩니다.
- 근거 없이 바꾸지 않습니다. 추정값이면 `provisional` 목록에 넣습니다.

### AI 파이프라인 (`pipeline/`)
- 시험용 세트(`gold/t*`, `gold/n*`)의 정답은 AI 결과를 본 뒤에 고치지 않습니다.
- 프롬프트를 고치는 데 쓴 세트는 더 이상 시험용이 아닙니다. 결과는 `pipeline/RESULTS.md`에 기록합니다.

## 5. 절대 올리지 않는 것
- **API 키** (OpenAI, Anthropic, 공공데이터포털): 환경변수로만 씁니다. 실수로 올렸다면 즉시 팀에 알리고 키를 폐기·재발급합니다.
- `node_modules/`, `dist/`, `.env`: `.gitignore`에 들어 있습니다.
- 개인정보 (실제 수급자 정보, 연락처)
