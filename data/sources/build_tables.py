"""데이터 출처·확인표·수집 목록·분석 결과를 CSV와 Excel로 만든다.

손으로 관리하는 원본(master):
  data/sources/sources.csv       데이터 출처 목록 (URL·문서번호·기준일)
  data/sources/value_checks.csv  수치별 근거 확인표 ([팀] 칸은 사람이 원문을 보고 채운다)

이 스크립트가 만드는 파일:
  data/sources/services_collected.csv   pipeline/raw 원문 69건 목록 (서비스 ID·복지로 URL·수집일)
  data/sources/오름_데이터_출처.xlsx     위 표 + 분석 결과를 시트별로 모은 Excel
  analysis/output/*.xlsx                 analysis/output/*.csv 의 Excel 판

실행:
  pip install -r requirements.txt
  python analysis/cliff_analysis.py      # 분석 CSV를 먼저 최신으로
  python data/sources/build_tables.py
"""
from __future__ import annotations

import csv
import re
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = ROOT / "data" / "sources"
RAW_DIR = ROOT / "pipeline" / "raw"
ANALYSIS_DIR = ROOT / "analysis" / "output"

BOKJIRO = "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId="
API_COLLECTED = "2026-11-14"  # 공공데이터포털 API 수집일 (커밋 20214a5)
# 학습용 원문(c*, l*)은 화면을 옮겨 적어 파일에 서비스 ID가 없다. 복지로에서 확인한 중앙 서비스 ID만 붙인다.
KNOWN_IDS = {"saeng": "WLF00001132", "jugeo": "WLF00003201", "edu": "WLF00001089",
             "basic_pension": "WLF00001164", "energy": "WLF00000072", "telecom": "WLF00003257", "eitc": "WLF00001148"}
SETS = {"c": "학습용 (중앙)", "l": "학습용 (지자체)", "t": "시험용 1차 (경산)", "n": "시험용 2차 (대구 북구·영천)", "api": "API 원문"}

FONT = "맑은 고딕"
HEAD_FILL = PatternFill("solid", fgColor="E8F3EC")
TEAM_FILL = PatternFill("solid", fgColor="FFF4C2")
THIN = Side(style="thin", color="D0D5DA")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def read_csv(path: Path) -> tuple[list[str], list[list[str]]]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    return rows[0], rows[1:]


def write_csv(path: Path, header: list[str], rows: list[list]) -> None:
    with open(path, "w", encoding="utf-8-sig", newline="") as f:  # BOM: Excel에서 한글이 깨지지 않게
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def collected_services() -> tuple[list[str], list[list[str]]]:
    header = ["파일", "세트", "서비스 ID", "서비스명", "제공주체", "출처", "수집일", "복지로 상세 URL"]
    rows = []
    for p in sorted(RAW_DIR.glob("*.txt")):
        head = p.read_text(encoding="utf-8").splitlines()[:5]
        meta = {m.group(1): m.group(2).strip() for line in head if (m := re.match(r"#\s*([^:]+):\s*(.*)", line))}
        prefix = "api" if p.name.startswith("api_") else p.name[0]
        sid = re.search(r"WLF\d{8}", p.name + " " + meta.get("출처", ""))
        sid = sid.group(0) if sid else next((v for k, v in KNOWN_IDS.items() if f"_{k}" in p.stem), "")
        date = re.search(r"\d{4}-\d{2}(-\d{2})?", meta.get("출처", ""))
        date = date.group(0) if date else (API_COLLECTED if prefix == "api" else "")
        rows.append([p.name, SETS.get(prefix, ""), sid, meta.get("서비스명", ""), meta.get("제공주체", ""),
                     meta.get("출처", ""), date, BOKJIRO + sid if sid else ""])
    return header, rows


def add_sheet(wb: Workbook, title: str, header: list[str], rows: list[list], widths: dict[int, int] | None = None,
              team_cols: set[int] = frozenset(), url_cols: set[int] = frozenset()) -> None:
    ws = wb.create_sheet(title)
    ws.append(header)
    for r in rows:
        ws.append([int(v) if isinstance(v, str) and re.fullmatch(r"-?\d+", v) and len(v) < 12 else v for v in r])
    for c, name in enumerate(header, 1):
        cell = ws.cell(row=1, column=c)
        cell.font = Font(name=FONT, bold=True)
        cell.fill = TEAM_FILL if c in team_cols else HEAD_FILL
        ws.column_dimensions[get_column_letter(c)].width = (widths or {}).get(c, min(max(len(name) * 2 + 2, 10), 40))
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.font = Font(name=FONT)
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = BORDER
            if cell.column in team_cols:
                cell.fill = TEAM_FILL
            if isinstance(cell.value, int):
                cell.number_format = "#,##0"
            if cell.column in url_cols and isinstance(cell.value, str) and cell.value.startswith("http"):
                cell.hyperlink = cell.value.split(" ")[0]
                cell.font = Font(name=FONT, color="1F5FBF", underline="single")
    for cell in ws[1]:
        cell.border = BORDER
        cell.alignment = Alignment(vertical="center", wrap_text=True)
    ws.freeze_panes = "B2"
    ws.auto_filter.ref = ws.dimensions


def guide_sheet(wb: Workbook) -> None:
    ws = wb.active
    ws.title = "안내"
    lines = [
        ("오름 데이터 출처·근거 확인표", True),
        ("", False),
        ("적용 기준: 2026년 (2026-01-01 시행 고시·조례 기준). 이미 발령된 2027년 고시는 반영하지 않음.", False),
        ("수집일: 공공데이터포털 API 2026-11-14 / 복지로 학습용 원문 2026-11 (첫 커밋 2026-11-14)", False),
        ("URL·문서번호 확인일: 2026-11-18 (국가법령정보센터·공공데이터포털에서 문서가 열리는지 확인)", False),
        ("수치 대조: '[팀]' 칸은 팀원이 URL의 원문을 직접 열어 값을 비교한 뒤 채운다. AI가 정리한 값을 그대로 쓰지 않는다.", False),
        ("", False),
        ("시트", True),
        ("데이터 출처: 사용한 데이터·문서 22개 (URL, 문서번호, 발령일, 적용 기준일)", False),
        ("수치 확인표: 계산에 쓰는 숫자 29개와 근거 위치. 노란 칸이 팀이 채울 곳", False),
        ("수집 복지서비스: AI 규칙 변환에 쓴 복지서비스 원문 69건 (서비스 ID, 복지로 URL, 수집일)", False),
        ("분석_가구별 절벽 / 분석_혜택 종료 지점: analysis/cliff_analysis.py 결과", False),
        ("", False),
        ("노란 칸 작성 예시 (실제 표에는 쓰지 않은 예시)", True),
    ]
    for i, (text, bold) in enumerate(lines, 1):
        c = ws.cell(row=i, column=1, value=text)
        c.font = Font(name=FONT, bold=bold, size=14 if i == 1 else 11)
    ex_head = ["[팀] 확인자", "[팀] 확인일", "[팀] 원문 값", "[팀] 일치(O/X)", "[팀] 메모"]
    ex_row = ["홍길동(예시)", "2026-11-19", "월 349,700원", "O", "고시 제3조 본문 확인"]
    r0 = len(lines) + 1
    for c, (h, v) in enumerate(zip(ex_head, ex_row), 1):
        for r, val, bold in ((r0, h, True), (r0 + 1, v, False)):
            cell = ws.cell(row=r, column=c, value=val)
            cell.font = Font(name=FONT, bold=bold)
            cell.fill = TEAM_FILL
            cell.border = BORDER
    ws.column_dimensions["A"].width = 22
    for col in "BCDE":
        ws.column_dimensions[col].width = 18


def main() -> None:
    src_h, src_rows = read_csv(SRC_DIR / "sources.csv")
    val_h, val_rows = read_csv(SRC_DIR / "value_checks.csv")
    svc_h, svc_rows = collected_services()
    write_csv(SRC_DIR / "services_collected.csv", svc_h, svc_rows)

    analysis = {}
    for name, title in (("cliff_summary", "분석_가구별 절벽"), ("benefit_endings", "분석_혜택 종료 지점")):
        path = ANALYSIS_DIR / f"{name}.csv"
        if path.exists():
            analysis[name] = (title, *read_csv(path))

    wb = Workbook()
    guide_sheet(wb)
    add_sheet(wb, "데이터 출처", src_h, src_rows, widths={1: 6, 2: 12, 3: 38, 4: 18, 5: 22, 6: 12, 7: 16, 8: 50, 9: 30, 10: 34, 11: 40}, url_cols={8})
    team = {i + 1 for i, h in enumerate(val_h) if h.startswith("[팀]")}
    add_sheet(wb, "수치 확인표", val_h, val_rows, widths={1: 6, 2: 24, 3: 22, 4: 44, 5: 10, 6: 26, 7: 14, 8: 20, 9: 26, 10: 30, 11: 12, 12: 12, 13: 18, 14: 10, 15: 24}, team_cols=team)
    add_sheet(wb, "수집 복지서비스", svc_h, svc_rows, widths={1: 24, 2: 22, 3: 14, 4: 30, 5: 22, 6: 40, 7: 12, 8: 50}, url_cols={8})
    for title, h, rows in analysis.values():
        add_sheet(wb, title, h, rows)
    wb.save(SRC_DIR / "오름_데이터_출처.xlsx")

    for name, (title, h, rows) in analysis.items():  # 분석 결과는 CSV 옆에 Excel 판도 둔다
        one = Workbook()
        one.remove(one.active)
        add_sheet(one, title.replace("분석_", ""), h, rows)
        one.save(ANALYSIS_DIR / f"{name}.xlsx")

    print(f"출처 {len(src_rows)} · 수치 {len(val_rows)} · 수집 서비스 {len(svc_rows)} · 분석 시트 {len(analysis)}")


if __name__ == "__main__":
    main()
