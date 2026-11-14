"""오름 AI 변환: 복지 서비스 원문(raw/*.txt) → LLM → 판정 규칙 JSON(ai_rules/*.json)

실행 예:
  python pipeline/convert.py                                   # Claude로 raw/ 전체 변환
  python pipeline/convert.py --provider openai                 # OpenAI로 변환 (기본 모델 gpt-5)
  python pipeline/convert.py --provider openai --model gpt-4.1 # 모델 지정
  python pipeline/convert.py --only c04_edu                    # 하나만
  python pipeline/convert.py --dry-run                         # API 호출 없이 프롬프트만 출력

인증: Claude는 ANTHROPIC_API_KEY(또는 `ant auth login`), OpenAI는 OPENAI_API_KEY
두 제공자 모두 같은 프롬프트와 같은 JSON Schema(구조화 출력)를 쓰므로 evaluate.py로 똑같이 채점할 수 있다.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from schema import FIELDS, RULE_SCHEMA  # noqa: E402

HERE = Path(__file__).resolve().parent
RAW_DIR, OUT_DIR = HERE / "raw", HERE / "ai_rules"
CLAUDE_MODEL = "claude-opus-5-5"
OPENAI_MODEL = "gpt-5"

SYSTEM_PROMPT = f"""당신은 한국 사회보장 제도의 선정기준을 계산 가능한 판정 규칙으로 바꾸는 분석가입니다.
복지로 서비스 원문을 읽고, 정해진 JSON 형식으로 규칙을 만드세요.

규칙:
1. 원문에 적힌 내용만 사용합니다. 원문에 없는 기준·금액을 배경지식으로 채우지 마세요.
2. 조건마다 evidence에 근거 구절을 원문 그대로 인용합니다.
3. field는 아래 목록에서만 고릅니다. 목록으로 표현할 수 없는 조건은 field="other"로 남깁니다.
4. 여러 조건 중 '하나 이상'이면 같은 group 이름을 붙이고, 반드시 모두 충족해야 하는 조건은 group을 빈 문자열로 둡니다.
5. judgeable(판정 가능 여부)은 '대부분의 신청자를 입력 항목만으로 1차 판정할 수 있는가'입니다.
   모든 신청자가 반드시 충족해야 하는 핵심 조건이 담당자 판단·의료비 사용량·자금 용도처럼 입력 항목으로 확인할 수 없는 것일 때만 false로 하고 이유를 적습니다.
   다음은 judgeable을 false로 만들지 않습니다. 이런 조건은 field="other"로 남기고 judgeable은 true로 둡니다.
   (a) 일부 사람에게만 해당하는 제외·예외 조건 (예: 고소득 부양의무자, 직역연금 수급자, 다른 법령으로 이미 지원받는 사람)
   (b) '하나 이상' 그룹 안에 입력으로 확인할 수 없는 경로가 섞인 경우 (확인 가능한 경로가 하나라도 있으면 true)
   (c) 신청·신고 절차 (출생신고, 신청 서류, 신청 기한)
   (d) 가구 유형 구분, 가구원 중 누구에게 해당하는지, 재혼 가정 같은 세부 확인
   반대로, 아래처럼 '대상이 되는 사람 자체'를 정하는 핵심 조건이 목록의 field에 없으면 judgeable은 false입니다.
   위 (a)~(d)에 해당하지 않는 한, 이런 조건이 하나라도 반드시 충족해야 하는 조건이면 false로 하고 이유를 적습니다.
   (e) 임신 중·임신 준비·출산 예정 (단, 이미 태어난 아이는 newborn·child_birth_order로 판정 가능)
   (f) 국가유공자·참전유공자·보훈대상자 등록, 특정 법률의 대상자
   (g) 사망·장례·화장 같은 사건이 일어난 사람이나 그 유족
   (h) 질병·사고·재해·실업 같은 위기 사유, 행려·노숙, 취업면접 예정, 자활 의지 같은 상황이나 담당자 판단
   판단 방법: "이 조건을 빼면 서비스 대상이 사실상 전 주민이 되는가?" 그렇다면 그 조건은 핵심 조건입니다.
6. 금액: 원문에 금액이 있으면 대표 월 금액(원)을 monthly_amount_won에 넣고(연액은 12로 나눔, 여러 개면 가장 기본이 되는 하나), 계산식이거나 원문에 금액이 없으면 0으로 둡니다.
   1회만 주는 금액(예: 가구당 20만 원, 위로금 30만 원)도 원문에 적힌 금액이므로 0으로 두지 말고 그 금액을 넣습니다. '○○만 원 한도', '실비', '○○% 지원'처럼 사람마다 달라지는 금액은 0입니다.
7. 값 형식: 숫자는 단위 없이(예: 32, 2470000, 65), 목록은 쉼표로(예: 생계,의료), 범위는 between과 '최소,최대', 참/거짓은 true/false.
   소득인정액이 '기준중위소득 n% 이하'면 income_recognized_pct_median <= n 으로 씁니다.
8. 기준 금액이 가구 유형별로 다르면(예: 단독가구/부부가구, 단독/홑벌이/맞벌이) 유형마다 같은 field로 조건을 하나씩 만들고 같은 group 이름(예: "가구유형별 기준")을 붙입니다. other에 문장으로 몰아 쓰지 마세요.
9. 목록의 field로 표현할 수 있으면 other를 쓰지 않습니다. 예: 영유아(7세 이하) → child_age <= 7, 자녀 2명 이상 → child_count >= 2, 노인 가구원 → senior_in_household == true, 차상위계층 → recipient_status 목록에 '차상위' 포함, 1년 이상 거주 → residence_months >= 12.
10. evidence에는 원문의 연속된 한 구절만 그대로 옮깁니다. 여러 구절을 이어 붙이거나 말을 바꾸지 마세요.

사용할 수 있는 field:
""" + "\n".join(f"- {k}: {v}" for k, v in FIELDS.items())


def load_raw(path: Path) -> tuple[str, str]:
    text = path.read_text(encoding="utf-8")
    name = next((ln.split(":", 1)[1].strip() for ln in text.splitlines() if ln.startswith("# 서비스명:")), path.stem)
    return name, text


def user_message(text: str) -> str:
    return "다음 복지 서비스 원문을 판정 규칙으로 변환하세요.\n\n<원문>\n" + text + "\n</원문>"


def make_meta(path: Path, model: str, effort: str, started: float, tin: int, tout: int, rid: str) -> dict:
    return {
        "source_file": path.name, "model": model, "effort": effort,
        "converted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seconds": round(time.time() - started, 1),
        "input_tokens": tin, "output_tokens": tout, "request_id": rid,
    }


def convert_claude(client, path: Path, effort: str, model: str) -> dict:
    _, text = load_raw(path)
    started = time.time()
    response = client.beta.messages.create(
        model=model,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",  # 안전 분류기가 거절하면 서버가 다른 모델로 자동 재시도
        system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": RULE_SCHEMA}},
        messages=[{"role": "user", "content": user_message(text)}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError(f"모델이 거절함: {response.stop_details}")
    if response.stop_reason == "max_tokens":
        raise RuntimeError("출력이 max_tokens에서 잘림")
    rule = json.loads(next(b.text for b in response.content if b.type == "text"))
    rule["_meta"] = make_meta(path, response.model, effort, started,
                              response.usage.input_tokens, response.usage.output_tokens, response._request_id)
    return rule


def convert_openai(client, path: Path, effort: str, model: str) -> dict:
    _, text = load_raw(path)
    started = time.time()
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user_message(text)}],
        response_format={"type": "json_schema",
                         "json_schema": {"name": "welfare_rule", "schema": RULE_SCHEMA, "strict": True}},
    )
    choice = response.choices[0]
    if choice.message.refusal:
        raise RuntimeError(f"모델이 거절함: {choice.message.refusal}")
    if choice.finish_reason == "length":
        raise RuntimeError("출력이 길이 제한에서 잘림")
    rule = json.loads(choice.message.content)
    rule["_meta"] = make_meta(path, response.model, "-", started,
                              response.usage.prompt_tokens, response.usage.completion_tokens, response.id)
    return rule


def main() -> None:
    ap = argparse.ArgumentParser(description="복지 서비스 원문 → 판정 규칙 JSON")
    ap.add_argument("--provider", default="claude", choices=["claude", "openai"])
    ap.add_argument("--model", help=f"모델 이름 (기본: Claude {CLAUDE_MODEL} / OpenAI {OPENAI_MODEL})")
    ap.add_argument("--only", nargs="*", help="변환할 원문 파일 이름(확장자 제외)")
    ap.add_argument("--prefix", help="이 글자로 시작하는 원문만 변환 (예: t = 시험용 세트)")
    ap.add_argument("--effort", default="medium", choices=["low", "medium", "high", "xhigh", "max"], help="Claude 전용")
    ap.add_argument("--out", default=str(OUT_DIR), help="결과 폴더 (제공자별로 나눠 비교할 때 사용)")
    ap.add_argument("--dry-run", action="store_true", help="API를 호출하지 않고 첫 원문의 프롬프트만 출력")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    paths = sorted(RAW_DIR.glob("*.txt"))
    if args.only:
        paths = [p for p in paths if p.stem in set(args.only)]
    if args.prefix:
        paths = [p for p in paths if p.stem.startswith(args.prefix)]
    if not paths:
        sys.exit("변환할 원문이 없습니다 (pipeline/raw/*.txt)")
    model = args.model or (CLAUDE_MODEL if args.provider == "claude" else OPENAI_MODEL)

    if args.dry_run:
        print("=== SYSTEM ===\n" + SYSTEM_PROMPT)
        print("\n=== USER (첫 원문) ===\n" + user_message(load_raw(paths[0])[1]))
        print(f"\n대상 {len(paths)}건, 제공자 {args.provider}, 모델 {model}")
        return

    if args.provider == "claude":
        import anthropic as sdk
        client, convert = sdk.Anthropic(), convert_claude
        auth_hint = "ANTHROPIC_API_KEY를 설정하거나 `ant auth login`을 실행하세요."
    else:
        import openai as sdk
        auth_hint = "OPENAI_API_KEY 환경변수를 설정하세요."
        try:
            client, convert = sdk.OpenAI(), convert_openai
        except sdk.OpenAIError:
            sys.exit("인증 정보 없음: " + auth_hint)

    out_dir = Path(args.out)
    out_dir.mkdir(exist_ok=True)
    total_in = total_out = 0
    for p in paths:
        try:
            rule = convert(client, p, args.effort, model)
        except sdk.AuthenticationError:
            sys.exit("인증 실패: " + auth_hint)
        except sdk.RateLimitError:
            print(f"[{p.stem}] 요청 한도 초과 또는 크레딧 부족 - 잠시 후 다시 실행하세요.")
            continue
        except sdk.APIStatusError as e:
            print(f"[{p.stem}] API 오류 {e.status_code}: {e.message}")
            continue
        except sdk.APIConnectionError:
            sys.exit("네트워크 오류: 인터넷 연결을 확인하세요.")
        except (RuntimeError, json.JSONDecodeError) as e:
            print(f"[{p.stem}] 변환 실패: {e}")
            continue
        (out_dir / f"{p.stem}.json").write_text(json.dumps(rule, ensure_ascii=False, indent=2), encoding="utf-8")
        m = rule["_meta"]
        total_in += m["input_tokens"]
        total_out += m["output_tokens"]
        print(f"[{p.stem}] 조건 {len(rule['conditions'])}개, 판정가능={rule['judgeable']}, {m['seconds']}초")

    msg = f"완료: 입력 {total_in:,} / 출력 {total_out:,} 토큰 → {out_dir}"
    if args.provider == "claude":
        msg += f", 예상 비용 약 ${total_in / 1e6 * 4 + total_out / 1e6 * 20:.2f} (Opus 5.5 정가 기준)"
    print(msg)


if __name__ == "__main__":
    main()
