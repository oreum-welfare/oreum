"""오름 AI 변환 평가: AI가 만든 규칙(ai_rules/) ↔ 사람이 만든 정답(gold/) 비교

실행:  python pipeline/evaluate.py [--ai 폴더]
결과:  pipeline/report/report.md, report.json, conditions.csv

채점 기준
- 조건 재현율: 정답 조건(선택 조건 제외) 중 AI가 항목·값·연산자를 맞힌 비율
- 조건 정밀도: AI 조건(other 제외) 중 정답(선택 조건 포함)과 맞는 비율
- 판정 가능 여부 일치율: judgeable 값이 정답과 같은 비율
- 근거 인용 일치율: AI 조건의 evidence가 원문에 실제로 있는 비율 (환각 점검)
- 금액 일치율: 월 금액이 허용값과 1% 안으로 맞는 비율 (원문에 없는 금액을 지어내면 오류)
- 서비스 정확도: 위 항목이 한 서비스 안에서 모두 맞은 비율
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LIST_ALIASES = {"생계급여": "생계", "의료급여": "의료", "주거급여": "주거", "교육급여": "교육",
                "차상위계층": "차상위", "기초생계": "생계", "기초의료": "의료", "기초주거": "주거"}


def norm_text(s: str) -> str:
    return re.sub(r"[\s·•\-\"'「」『』()\[\]<>]", "", s or "")


def to_number(v: str) -> float | None:
    s = str(v).replace(",", "").replace("원", "").replace("%", "").replace("세", "").replace("개월", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def to_set(v: str) -> set[str]:
    out = set()
    for tok in re.split(r"[,/·\s]+", str(v)):
        tok = tok.strip().replace("수급자", "")
        if tok:
            out.add(LIST_ALIASES.get(tok, tok))
    return out


def value_matches(ai_val: str, gold_vals: list[str], op: str) -> bool:
    for g in gold_vals:
        if g == "*":
            return True
        if op == "between" or ("," in g and to_number(g.split(",")[0]) is not None):
            a = [to_number(x) for x in str(ai_val).split(",")]
            b = [to_number(x) for x in g.split(",")]
            if len(a) == len(b) and all(x is not None and y is not None and abs(x - y) < 1e-6 for x, y in zip(a, b)):
                return True
            continue
        gn, an = to_number(g), to_number(ai_val)
        if gn is not None and an is not None:
            if abs(gn - an) <= max(abs(gn) * 0.005, 1e-6):
                return True
            continue
        if g.lower() in ("true", "false"):
            if str(ai_val).strip().lower() == g.lower():
                return True
            continue
        if "," in g or "," in str(ai_val):
            if to_set(g) == to_set(ai_val):
                return True
            continue
        if norm_text(g) in norm_text(ai_val) or norm_text(ai_val) in norm_text(g):
            return True
    return False


def gold_fields(gc: dict) -> list[str]:
    return gc["field"] if isinstance(gc["field"], list) else [gc["field"]]


def cond_match(ai: dict, gc: dict) -> tuple[bool, bool]:
    """(항목+값 일치, 연산자까지 일치)"""
    if ai["field"] not in gold_fields(gc):
        return False, False
    vals = [gc["value"], *gc.get("accept", [])]
    if not value_matches(ai["value"], vals, ai["op"]):
        return False, False
    return True, ai["op"] in [gc["op"], *gc.get("op_accept", [])]


def list_subset(ai: dict, gc: dict) -> bool:
    """AI 값이 정답 목록 값의 일부인지 (예: 정답 '생계,의료,주거,교육,차상위'에서 '차상위'만 따로 쓴 경우)"""
    if ai["field"] not in gold_fields(gc) or gc["op"] != "in":
        return False
    a = to_set(ai["value"])
    return bool(a) and any(v != "*" and a <= to_set(v) for v in [gc["value"], *gc.get("accept", [])])


def is_grounded(evidence: str, source: str) -> bool:
    """근거 인용이 원문에 있는지. 여러 구절을 ' / ' 나 '…'로 이어 붙였으면 구절마다 확인한다."""
    parts = [p for p in re.split(r"\s/\s|…|\.\.\.", evidence or "") if norm_text(p)]
    src = norm_text(source)
    return bool(parts) and all(norm_text(p) in src for p in parts)


def evaluate_service(gold: dict, ai: dict, source: str) -> dict:
    gold_req = [g for g in gold["conditions"] if not g.get("optional") and g["field"] != "other"]
    ai_conds = [c for c in ai["conditions"] if c["field"] != "other"]
    used, details = set(), []
    for gc in gold_req:
        best = None
        for i, c in enumerate(ai_conds):
            if i in used:
                continue
            fv, full = cond_match(c, gc)
            if full:
                best = (i, True)
                break
            if fv and best is None:
                best = (i, False)
        if best:
            used.add(best[0])
        elif gc["op"] == "in":
            # 목록 조건을 같은 그룹의 '==' 조건 여러 개(OR)로 나눠 쓴 경우: 그룹의 값 합집합이 정답 목록과 같으면 정답
            groups: dict[str, list[int]] = {}
            for i, c in enumerate(ai_conds):
                if i not in used and c["field"] in gold_fields(gc) and c["group"]:
                    groups.setdefault(c["group"], []).append(i)
            for idx in groups.values():
                union = set().union(*(to_set(ai_conds[i]["value"]) for i in idx))
                if any(v != "*" and union == to_set(v) for v in [gc["value"], *gc.get("accept", [])]):
                    used.update(idx)
                    details.append({"gold": f"{'/'.join(gold_fields(gc))} {gc['op']} {gc['value']}",
                                    "ai": " | ".join(f"{ai_conds[i]['field']} {ai_conds[i]['op']} {ai_conds[i]['value']}" for i in idx),
                                    "result": "정답"})
                    break
            else:
                details.append({"gold": f"{'/'.join(gold_fields(gc))} {gc['op']} {gc['value']}", "ai": "", "result": "누락"})
            continue
        details.append({"gold": f"{'/'.join(gold_fields(gc))} {gc['op']} {gc['value']}",
                        "ai": (lambda c: f"{c['field']} {c['op']} {c['value']}")(ai_conds[best[0]]) if best else "",
                        "result": "정답" if best and best[1] else ("연산자 다름" if best else "누락")})
    correct = sum(1 for d in details if d["result"] == "정답")
    # 정밀도: AI 조건 중 정답(필수 또는 선택)과 맞는 것
    extras = []
    for i, c in enumerate(ai_conds):
        if i in used:
            continue
        # 정답의 다른 허용값(예: 가구유형별 기준을 유형마다 따로 쓴 경우)이나 목록의 일부(예: 차상위만 따로 쓴 경우)도 정답으로 본다
        if any(cond_match(c, gc)[0] or list_subset(c, gc) for gc in gold["conditions"]):
            used.add(i)
            continue
        extras.append(f"{c['field']} {c['op']} {c['value']}")
    precision_hits = len(ai_conds) - len(extras)
    grounded = [c for c in ai["conditions"] if is_grounded(c["evidence"], source)]
    amt = ai["benefit"]["monthly_amount_won"]
    amount_ok = any(abs(amt - a) <= max(a * 0.01, 1) for a in gold["benefit"]["amount_accept"])
    judge_ok = ai["judgeable"] == gold["judgeable"]
    return {
        "id": gold["id"], "service": ai.get("service_name", gold["id"]),
        "gold_required": len(gold_req), "correct": correct,
        "ai_conditions": len(ai_conds), "precision_hits": precision_hits, "extras": extras,
        "evidence_total": len(ai["conditions"]), "evidence_grounded": len(grounded),
        "judgeable_ok": judge_ok, "amount_ok": amount_ok, "ai_amount": amt,
        "gold_amount": gold["benefit"]["amount_accept"], "amount_note": gold["benefit"].get("note", ""),
        "service_ok": judge_ok and amount_ok and correct == len(gold_req) and not extras,
        "details": details,
    }


def pct(a: float, b: float) -> str:
    return f"{a / b * 100:.0f}%" if b else "-"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ai", default=str(HERE / "ai_rules"), help="AI 규칙 폴더")
    ap.add_argument("--out", default=str(HERE / "report"))
    ap.add_argument("--set", default="train", choices=["train", "test", "test2", "all"],
                    help="train = 1·2차 프롬프트 개선에 쓴 13건, test = 경산 14건 (3차 개선에 사용), test2 = 대구 북구·영천 16건 (처음 보는 서비스)")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    ai_dir, out = Path(args.ai), Path(args.out)

    results, missing = [], []
    for gp in sorted((HERE / "gold").glob("*.json")):
        gold = json.loads(gp.read_text(encoding="utf-8"))
        if args.set != "all" and gold.get("set", "train") != args.set:
            continue
        ap_ = ai_dir / gp.name
        if not ap_.exists():
            missing.append(gp.stem)
            continue
        ai = json.loads(ap_.read_text(encoding="utf-8"))
        source = (HERE / "raw" / f"{gp.stem}.txt").read_text(encoding="utf-8")
        results.append(evaluate_service(gold, ai, source))
    if not results:
        sys.exit(f"평가할 AI 규칙이 없습니다: {ai_dir} (먼저 convert.py 실행)")

    n = len(results)
    S = lambda k: sum(r[k] for r in results)  # noqa: E731
    summary = {
        "services": n,
        "service_accuracy": S("service_ok") / n,
        "condition_recall": S("correct") / S("gold_required"),
        "condition_precision": S("precision_hits") / max(S("ai_conditions"), 1),
        "judgeable_agreement": S("judgeable_ok") / n,
        "evidence_grounding": S("evidence_grounded") / max(S("evidence_total"), 1),
        "amount_accuracy": S("amount_ok") / n,
        "missing": missing,
    }
    out.mkdir(exist_ok=True)
    (out / "report.json").write_text(json.dumps({"summary": summary, "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    with open(out / "conditions.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["서비스", "정답 조건", "AI 조건", "결과"])
        for r in results:
            for d in r["details"]:
                w.writerow([r["service"], d["gold"], d["ai"], d["result"]])
            for e in r["extras"]:
                w.writerow([r["service"], "", e, "정답에 없는 조건"])

    lines = ["# AI 판정 규칙 변환 평가", "",
             f"- 평가 서비스: {n}건" + (f" (AI 결과 없음: {', '.join(missing)})" if missing else ""),
             f"- **서비스 정확도: {pct(S('service_ok'), n)}** ({S('service_ok')}/{n}건이 조건·판정가능여부·금액 모두 정답)",
             f"- 조건 재현율: {pct(S('correct'), S('gold_required'))} ({S('correct')}/{S('gold_required')})",
             f"- 조건 정밀도: {pct(S('precision_hits'), S('ai_conditions'))} ({S('precision_hits')}/{S('ai_conditions')})",
             f"- 판정 가능 여부 일치: {pct(S('judgeable_ok'), n)}",
             f"- 근거 인용 일치(환각 점검): {pct(S('evidence_grounded'), S('evidence_total'))}",
             f"- 금액 일치: {pct(S('amount_ok'), n)}", "",
             "| 서비스 | 조건 | 정밀도 | 판정가능 | 금액 | 근거 인용 | 결과 |", "|---|---|---|---|---|---|---|"]
    for r in results:
        lines.append(f"| {r['service']} | {r['correct']}/{r['gold_required']} | {r['precision_hits']}/{r['ai_conditions']} | "
                     f"{'O' if r['judgeable_ok'] else 'X'} | {'O' if r['amount_ok'] else 'X (AI ' + format(r['ai_amount'], ',') + '원)'} | "
                     f"{r['evidence_grounded']}/{r['evidence_total']} | {'✅' if r['service_ok'] else '⚠️'} |")
    lines += ["", "## 틀린 부분"]
    for r in results:
        issues = [f"{d['gold']} → {d['result']}" + (f" (AI: {d['ai']})" if d["ai"] else "") for d in r["details"] if d["result"] != "정답"]
        issues += [f"정답에 없는 조건: {e}" for e in r["extras"]]
        if not r["judgeable_ok"]:
            issues.append("판정 가능 여부가 정답과 다름")
        if not r["amount_ok"]:
            issues.append(f"금액 {r['ai_amount']:,}원 (정답: {r['amount_note']})")
        if issues:
            lines.append(f"- **{r['service']}**: " + "; ".join(issues))
    (out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:10]))
    print(f"\n저장: {out / 'report.md'}")


if __name__ == "__main__":
    main()
