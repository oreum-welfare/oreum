"""AI 검수 화면용 데이터 묶기: 원문 + AI 규칙 + 정답 + 채점 결과 → pipeline/review_export.json

실행:  python pipeline/export_review.py [--ai runs_v2_gpt5_rules]
그다음 React 앱에서 `npm run sync-data`(또는 dev/build)를 실행하면 앱으로 복사된다.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from evaluate import evaluate_service  # noqa: E402


def run_summary(folder: str) -> dict | None:
    p = HERE / folder / "report.json"
    return json.loads(p.read_text(encoding="utf-8"))["summary"] if p.exists() else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ai", default="runs_v2_gpt5_rules", help="검수할 AI 규칙 폴더 (pipeline 기준)")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    ai_dir = HERE / args.ai

    services = []
    for gp in sorted((HERE / "gold").glob("*.json")):
        ap_ = ai_dir / gp.name
        if not ap_.exists():
            continue
        gold = json.loads(gp.read_text(encoding="utf-8"))
        ai = json.loads(ap_.read_text(encoding="utf-8"))
        raw = (HERE / "raw" / f"{gp.stem}.txt").read_text(encoding="utf-8")
        header = {ln.split(":", 1)[0][2:].strip(): ln.split(":", 1)[1].strip() for ln in raw.splitlines() if ln.startswith("# ")}
        body = "\n".join(ln for ln in raw.splitlines() if not ln.startswith("# ")).strip()
        services.append({
            "id": gp.stem,
            "name": header.get("서비스명", gp.stem),
            "provider": header.get("제공주체", ""),
            "source": header.get("출처", ""),
            "text": body,
            "ai": {k: v for k, v in ai.items() if k != "_meta"},
            "meta": ai.get("_meta", {}),
            "gold": gold,
            "eval": evaluate_service(gold, ai, raw),
        })
    out = {
        "ai_folder": args.ai,
        "runs": {"v1": run_summary("runs_v1_gpt5_report_final"), "v2": run_summary("runs_v2_gpt5_report_final")},
        "services": services,
    }
    (HERE / "review_export.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(services)}건 → {HERE / 'review_export.json'}")


if __name__ == "__main__":
    main()
