# 오름 AI 변환 파이프라인

복지 서비스 **선정기준 원문**을 AI(GPT-5)가 **판정 규칙 JSON**으로 바꾸고, 사람이 만든 정답과 비교해 **정확도**를 계산합니다. 결과는 사람이 검수한 뒤 규칙 파일(`data/rules.json`)에 반영합니다.

```
[공공데이터포털 복지서비스 API] ──fetch_bokjiro.py──▶ raw/*.txt
                                                         │
                                    convert.py (GPT-5 또는 Claude, 구조화 출력)
                                                         ▼
                                              runs_*/ (AI 규칙) ──evaluate.py──▶ 채점 결과
                                                         │                (정답: gold/*.json)
                                     export_review.py ───┤
                                                         ▼
                                  React 검수 화면(/review) → 사람이 승인한 규칙만 rules.json에 반영
                                  export_ai_results.py → React AI 성능 화면(/ai)
```

## 폴더
| 폴더·파일 | 내용 |
|---|---|
| `raw/` | 서비스 원문. 학습용 13건(`c*` 중앙, `l*` 지자체, 화면을 옮겨 적음), 시험용 30건(`t*` 경산, `n*` 대구 북구·영천, 복지로 상세 페이지 자동 수집), API 원문 26건(`api_*`, 지자체 18 + 중앙 8) |
| `gold/` | 사람이 원문을 보고 만든 정답 규칙 43건 (`set`: train / test / test2) |
| `runs_*/` | 단계별 AI 변환 결과와 채점 (`runs_v1…`, `runs_v2…`, `runs_test…`, `runs_v3…`) |
| `RESULTS.md` | 실험 기록과 발표용 문장 |
| `ai_results.json` | 단계별 결과 요약 (React AI 성능 화면용) |
| `collected/` | 복지로 상세 페이지에서 자동 수집한 원본 (날짜별) |
| `schema.py` | 규칙 형식 (조건 항목 목록, JSON Schema) |

## 실행 순서
```bash
pip install -r requirements.txt
```
1. **인증:** OpenAI는 `OPENAI_API_KEY`, Claude는 `ANTHROPIC_API_KEY` 환경변수 (PowerShell: `$env:OPENAI_API_KEY = "키"`). 키는 코드·채팅·GitHub에 올리지 않습니다.
2. **변환:** 실험은 모두 GPT-5로 했습니다. 코드의 기본 제공자는 Claude라서 `--provider openai`를 붙입니다.
```bash
python pipeline/convert.py --provider openai --prefix n --out pipeline/runs_new_rules
```
`--prefix`로 세트를 고릅니다 (`c`/`l` 학습용, `t`·`n` 시험용, `api` API 원문). 모델은 `--model`로 바꿉니다.
3. **채점:** `--set`은 train(학습용 13건), test(경산 14건), test2(대구 북구·영천 16건), all
```bash
python pipeline/evaluate.py --set test2 --ai pipeline/runs_new_rules --out pipeline/runs_new_report
```
4. **화면용 데이터:** `python pipeline/export_ai_results.py` (AI 성능), `python pipeline/export_review.py` (검수)

API 호출 없이 프롬프트만 보려면 `python pipeline/convert.py --dry-run`.

## 실험 결과 (2026-11-14, GPT-5)
| 프롬프트 | 세트 | 서비스 정확도 |
|---|---|---|
| 1차 | 학습용 13건 | 38% |
| 2차 | 학습용 13건 (같은 문제로 고침) | 85% |
| 2차 | 처음 보는 경산 14건 | 36% |
| 3차 | **처음 보는 대구 북구·영천 16건** | **81%** |
| 3차 | 학습용 13건 (회귀 확인) | 62% |

모든 단계에서 원문에 없는 조건이나 금액을 지어낸 경우는 없었습니다. 자세한 내용: [RESULTS.md](RESULTS.md)

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

## 공공데이터포털 API로 수집하기
한국사회보장정보원 **지자체복지서비스** API (활용신청 후 일반 인증키 Decoding 사용):
```bash
$env:DATA_GO_KR_KEY = "발급받은_Decoding_키"
python pipeline/fetch_bokjiro.py --local --sido 경상북도 --sigungu 경산시 --limit 30
python pipeline/convert.py --provider openai --prefix api --out pipeline/runs_api_rules
```
- 결과: `raw/api_<서비스ID>.txt` (서비스 요약, 지원대상, 선정기준, 서비스 내용, 신청방법 + 담당부서·첨부파일 등 참고 정보)
- 검증 (2026-11-14): 경산시 18건 수집. 복지로 상세 페이지에서 모은 원문과 14건 중 13건 동일, 1건은 API에 소제목이 더 있음
- API 원문에는 줄바꿈이 없습니다.
- 중앙부처 API (한국사회보장정보원_중앙부처복지서비스, 따로 활용신청):
  ```bash
  python pipeline/fetch_bokjiro.py --central --search 생계급여 --limit 5
  ```
  실제 호출로 확인했습니다 (2026-11-14). 앱이 쓰는 중앙 제도 8종을 받았고, 복지로 화면에서 옮겨 적은 원문(`c01~c08`)의 97~100%가 API 원문 안에 있습니다. API 쪽에는 서비스 내용 등이 더 있어서 더 완전합니다.
  - 주의: 기초연금은 API 원문에 금액(349,700원)이 있습니다. 학습용 원문(`c05`)에는 금액이 없어 '함정 문항'이었으므로, API 원문으로 다시 채점하면 정답 금액이 달라집니다. 여러 서비스는 `--search 생계급여 주거급여 교육급여`처럼 띄어 쓰면 한 번에 받습니다.
- 정답이 없는 서비스는 정확도 계산에서 빠지고, 규칙만 생성됩니다.

## 한계
- 학습용 원문 13건은 복지로 화면을 옮겨 적은 것입니다. 같은 서비스의 API 원문(`api_*`)과 대조하면 우리 원문의 97~100%가 API 원문 안에 있습니다.
- 정답(gold)은 팀이 만든 것이라 해석 차이가 있을 수 있습니다. 허용 값(`accept`)과 선택 조건(`optional`)으로 일부 반영했습니다.
