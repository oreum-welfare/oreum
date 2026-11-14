# 오름 AI 변환 파이프라인

복지 서비스 **선정기준 원문**을 Claude가 **판정 규칙 JSON**으로 바꾸고, 사람이 만든 정답과 비교해 **정확도**를 계산합니다.

```
[복지로 원문] ──fetch_bokjiro.py──▶ raw/*.txt
                                     │
                       convert.py (Claude Opus 5.5, 구조화 출력)
                                     ▼
                               ai_rules/*.json ──evaluate.py──▶ report/report.md
                                     ▲                      (정답: gold/*.json)
```

## 폴더
| 폴더·파일 | 내용 |
|---|---|
| `raw/` | 서비스 원문 13건 (복지로 화면에서 수집). API로 받은 원문도 같은 형식으로 저장 |
| `gold/` | 사람이 원문을 보고 만든 정답 규칙 13건 |
| `ai_rules/` | Claude가 만든 규칙 (convert.py 실행 결과) |
| `report/` | 평가 결과: `report.md`(요약), `report.json`, `conditions.csv`(조건별 채점) |
| `schema.py` | 규칙 형식 (조건 항목 목록, JSON Schema) |

## 실행 순서
```bash
pip install -r requirements.txt
```
1. **인증:** OpenAI는 `OPENAI_API_KEY`, Claude는 `ANTHROPIC_API_KEY` 환경변수 설정 (PowerShell: `$env:OPENAI_API_KEY = "키"`)
2. **변환** (13건, 약 1~3분)
```bash
python pipeline/convert.py --provider openai
```
Claude로 하려면 `--provider claude`(기본값). 모델을 바꾸려면 `--model gpt-4.1` 처럼 지정합니다.
두 제공자를 비교하려면 결과 폴더를 나눕니다: `--out pipeline/ai_rules_openai` → `python pipeline/evaluate.py --ai pipeline/ai_rules_openai --out pipeline/report_openai`
3. **평가**
```bash
python pipeline/evaluate.py
```
4. `pipeline/report/report.md`에서 결과 확인

API 호출 없이 프롬프트만 보려면 `python pipeline/convert.py --dry-run`.

## 실험 결과 (2026-11-14, GPT-5)
1차 38% → 프롬프트 개선 후 2차 **85%** (13건 중 11건 완전 정답, 지어낸 조건·금액 0건). 자세한 내용: [RESULTS.md](RESULTS.md) 처음 보는 14건(시험용)에서는 **36%** (판정 불가 서비스 구분 오류 7건).

## 시험용 세트 (처음 보는 서비스 14건)
복지로에 등록된 경산시 지자체 서비스 18건 중, 기존 13건에 없던 14건(`raw/t01~t14`)을 2026-11-14에 수집했습니다.
정답(`gold/t*.json`)은 **AI 결과를 보기 전에** 작성했고, 프롬프트 개선에 쓰지 않았습니다. 그래서 이 점수가 '처음 보는 서비스'에서의 실제 성능에 가깝습니다.
```bash
python pipeline/convert.py --provider openai --prefix t --out pipeline/runs_test_gpt5_rules
python pipeline/evaluate.py --set test --ai pipeline/runs_test_gpt5_rules --out pipeline/runs_test_gpt5_report
```
기존 13건은 `--set train`(기본값), 둘 다는 `--set all`.

## 3차 프롬프트와 2차 시험용 세트 (대구 북구·영천 16건)
경산 14건 결과(36%)를 보고 프롬프트를 고쳤습니다(3차). 그래서 경산 14건은 이제 **개선에 쓴 세트**이고, 새로 **처음 보는 서비스 16건**을 따로 두었습니다.
- 3차에서 바꾼 것: 판정 불가의 기준(임신·보훈·사망·위기 사유처럼 대상 자체를 정하는 조건이 입력 밖이면 판정 불가), 1회 지급 금액도 기록, '1년 이상 거주' → `residence_months >= 12`
- 2차 시험용: 대구 북구 지자체 서비스 7건 중 기존에 없던 6건 + 경북 영천시 18건 중 10건 (`raw/n01~n16`, `gold/n*.json`, set=`test2`)
- 정답은 3차 프롬프트를 확정한 **뒤**, AI 결과를 보기 **전에** 작성했습니다. 정답을 그대로 넣으면 100% (2026-11-14).
```bash
python pipeline/convert.py --provider openai --out pipeline/runs_v3_gpt5_rules
python pipeline/evaluate.py --set test2 --ai pipeline/runs_v3_gpt5_rules --out pipeline/runs_v3_report_test2
python pipeline/evaluate.py --set test --ai pipeline/runs_v3_gpt5_rules --out pipeline/runs_v3_report_test
python pipeline/evaluate.py --set train --ai pipeline/runs_v3_gpt5_rules --out pipeline/runs_v3_report_train
```
첫 줄은 43건 전체를 3차 프롬프트로 다시 변환합니다(약 15~20분). 새 16건만 하려면 `--prefix n`.

## 채점 기준
| 지표 | 뜻 |
|---|---|
| 서비스 정확도 | 조건·판정가능여부·금액이 모두 맞은 서비스 비율 |
| 조건 재현율 | 정답 조건 중 AI가 항목·값·연산자를 맞힌 비율 |
| 조건 정밀도 | AI가 만든 조건 중 정답과 맞는 비율 (지어낸 조건이 있으면 내려감) |
| 판정 가능 여부 일치 | 담당자 판단이 필요한 서비스를 '판정 불가'로 알아보는지 |
| 근거 인용 일치 | AI가 인용한 근거 문장이 원문에 실제로 있는지 (환각 점검) |
| 금액 일치 | 월 금액이 맞는지. **원문에 금액이 없는데 지어내면 오류** (기초연금·다자녀가 함정 문항) |

채점기 자체 검증: 정답을 그대로 넣으면 100%, 일부러 실수 6개를 심으면 6개 모두 잡아냄 (2026-11-13).

## 더 많은 서비스로 넓히기
공공데이터포털에서 '한국사회보장정보원 복지서비스' API 활용신청 후:
```bash
set DATA_GO_KR_KEY=발급받은_인증키
python pipeline/fetch_bokjiro.py --local --sido 경상북도 --sigungu 경산시 --limit 30
python pipeline/convert.py --only api_XXXX
```
⚠️ `fetch_bokjiro.py`의 엔드포인트와 항목 이름은 활용가이드로 확인 후 사용하세요 (아직 실제 호출로 검증하지 않음).
정답이 없는 서비스는 정확도 계산에서 빠지고, 규칙만 생성됩니다.

## 한계
- `raw/`의 원문 13건은 복지로 화면 캡처를 옮겨 적은 것입니다 (API 원문 아님).
- 정답(gold)은 팀이 만든 것이라 해석 차이가 있을 수 있습니다. 허용 값(`accept`)과 선택 조건(`optional`)으로 일부 반영했습니다.
