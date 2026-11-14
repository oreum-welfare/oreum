"""AI 실험 결과 요약 → pipeline/ai_results.json (React 'AI 성능' 화면용)

실행: python pipeline/export_ai_results.py
각 단계의 채점 결과(report.json)를 모아 단계별 지표와 서비스별 정답·오류 유형을 정리한다.
아직 채점하지 않은 단계는 status="pending"으로 남긴다.
"""
import json
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent

# 표시 순서대로. unseen = 프롬프트를 고칠 때 보지 않은 '처음 보는 서비스'로 잰 점수인지
STAGES = [
    {"key": "v1", "prompt": "1차", "set": "학습용 13건", "unseen": False, "report": "runs_v1_gpt5_report_final"},
    {"key": "v2", "prompt": "2차", "set": "학습용 13건", "unseen": False, "report": "runs_v2_gpt5_report_final"},
    {"key": "test1", "prompt": "2차", "set": "처음 보는 경산 14건", "unseen": True, "report": "runs_test_gpt5_report"},
    {"key": "test2", "prompt": "3차", "set": "처음 보는 대구 북구·영천 16건", "unseen": True, "report": "runs_v3_report_test2"},
    {"key": "v3train", "prompt": "3차", "set": "학습용 13건 (회귀 확인)", "unseen": False, "report": "runs_v3_report_train"},
]


def error_types(r: dict) -> list[str]:
    """틀린 서비스의 오류 유형 (여러 개일 수 있음)"""
    out = []
    if not r["judgeable_ok"]:
        out.append("판정 가능 여부")
    if r["correct"] < r["gold_required"]:
        out.append("조건 누락·오류")
    if r["extras"]:
        out.append("정답에 없는 조건")
    if not r["amount_ok"]:
        out.append("금액")
    return out


def main() -> None:
    stages = []
    for st in STAGES:
        path = HERE / st["report"] / "report.json"
        item = {k: st[k] for k in ("key", "prompt", "set", "unseen")}
        if not path.exists():
            stages.append({**item, "status": "pending"})
            continue
        rep = json.loads(path.read_text(encoding="utf-8"))
        services = [{
            "id": r["id"], "name": r["service"], "ok": r["service_ok"],
            "errors": [] if r["service_ok"] else error_types(r),
            "missing": [d["gold"] for d in r["details"] if d["result"] != "정답"],
            "extras": r["extras"],
        } for r in rep["results"]]
        stages.append({**item, "status": "done", "summary": rep["summary"], "services": services})
    out = {"updated": date.today().isoformat(), "model": "gpt-5-2025-08-07", "stages": stages}
    (HERE / "ai_results.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("저장: pipeline/ai_results.json", [f"{s['key']}:{s['status']}" for s in stages])


if __name__ == "__main__":
    main()
