## 무엇을 바꿨나요
<!-- 한두 문장으로 -->

관련 이슈: closes #

## 종류
- [ ] 기능 (feat)
- [ ] 버그 수정 (fix)
- [ ] 데이터·금액 (data)
- [ ] 디자인·UI (design)
- [ ] AI 파이프라인 (ai)
- [ ] 문서 (docs)

## 확인한 것
- [ ] 받는 브랜치가 `develop`입니다 (`main`은 develop → main 합칠 때만)
- [ ] 로컬에서 실행해 봤습니다 (`cd oreum-web && npm run dev`)
- [ ] 화면을 바꿨다면 스크린샷을 아래에 붙였습니다

### 계산·데이터를 바꿨다면
- [ ] `oreum-web/src/lib/engine.js`와 `rules.py` 두 곳을 똑같이 고쳤습니다
- [ ] `python tests/parity_py.py && node tests/parity.mjs` 가 "모두 일치"로 끝납니다
- [ ] `node tests/engine_checks.mjs` 가 "모두 통과"로 끝납니다
- [ ] (AI 채점기를 바꿨다면) `python tests/grader_checks.py` 가 "모두 통과"로 끝납니다
- [ ] `rules.json`에서 바꾼 값의 `verification`(근거·확인 상태)도 고쳤습니다

## 스크린샷 / 참고
