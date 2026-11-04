"""Read-only November workbook preview. Prints JSON; never connects to a database.

Run: python3 scripts/preview_november_budget.py /absolute/path/to/workbook.xlsx
Keep its output private and outside the repository. Values are decimal strings.
Production mapping and labor definitions are confirmed by the reviewed findings.
Authoritative membership baselines are supplied separately from this workbook.
"""
import datetime
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def column(number):
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def preview(path):
    with zipfile.ZipFile(path) as archive:
        strings = ["".join(x.itertext()) for x in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("m:si", NS)]
        relations = {r.get("Id"): r.get("Target") for r in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        sheets = {}
        for sheet in ET.fromstring(archive.read("xl/workbook.xml")).find("m:sheets", NS):
            target = relations[sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")]
            target = target.lstrip("/") if target.startswith("/") else "xl/" + target
            cells = {}
            for cell in ET.fromstring(archive.read(target)).findall("m:sheetData/m:row/m:c", NS):
                value = cell.find("m:v", NS)
                if value is None:
                    continue
                if cell.get("t") == "e":
                    raise ValueError("Spreadsheet error: " + cell.get("r"))
                cells[cell.get("r")] = strings[int(value.text)] if cell.get("t") == "s" else Decimal(value.text)
            sheets[sheet.get("name")] = cells
    cells = sheets["Nov Plan"]
    records = {}
    for category, header, start in [("total", 3, 4), ("retail", 28, 29), ("recurring", 53, 54)]:
        sites = [int(cells["A" + str(row)]) for row in range(start, start + 20)]
        if len(set(sites)) != 20 or 1508 not in sites or set(sites) & {1509, 1523}:
            raise ValueError("Invalid or duplicate sites")
        for number in range(3, 33):
            date = datetime.date(1899, 12, 30) + datetime.timedelta(days=int(cells[column(number) + str(header)]))
            if date != datetime.date(2026, 11, 1) + datetime.timedelta(days=number - 3):
                raise ValueError("Unexpected business date")
            network = Decimal(0)
            for row, site in zip(range(start, start + 20), sites):
                value = cells[column(number) + str(row)]
                if not isinstance(value, Decimal) or not value.is_finite() or value < 0:
                    raise ValueError("Invalid daily revenue value")
                record = records.setdefault((site, date.isoformat()), {"site_code": str(site), "business_date": date.isoformat()})
                record[category] = value
                network += value
            if abs(network - cells[column(number) + str(start + 20)]) > Decimal("0.000001"):
                raise ValueError("Daily network control mismatch")
        for row in range(start, start + 20):
            total = sum(cells[column(number) + str(row)] for number in range(3, 33))
            if any(abs(total - cells[col + str(row)]) > Decimal("0.000001") for col in ["B", "AH"]):
                raise ValueError("Site monthly control mismatch")
    if len(records) != 600 or any(set(r) != {"site_code", "business_date", "total", "retail", "recurring"} for r in records.values()):
        raise ValueError("Incomplete revenue coverage")
    if any(abs(r["total"] - r["retail"] - r["recurring"]) > Decimal("0.000001") for r in records.values()):
        raise ValueError("Revenue categories do not reconcile")
    labor_cells = sheets["Labor and Membership Goals"]
    labor = []
    for row in range(3, 23):
        site = int(labor_cells["A" + str(row)])
        values = {key: labor_cells.get(col + str(row)) for key, col in [("weekly_hours", "B"), ("weekly_hours_with_manager", "C"), ("full_service_labor_percentage", "D")]}
        if site in [1508, 1511]:
            if values["weekly_hours"] is not None or values["weekly_hours_with_manager"] is not None or not Decimal(0) <= values["full_service_labor_percentage"] <= Decimal(1):
                raise ValueError("Invalid percentage labor budget")
        elif values["weekly_hours_with_manager"] != values["weekly_hours"] + 45 or values["full_service_labor_percentage"] is not None:
            raise ValueError("Labor formula/cache mismatch")
        labor.append({"site_code": str(site), "effective_month": "2026-11-01", **values})
    if {r["site_code"] for r in labor} != {r["site_code"] for r in records.values()} or len({r["site_code"] for r in labor}) != 20:
        raise ValueError("Labor/revenue site mismatch")
    totals = {key: sum(r[key] for r in records.values()) for key in ["total", "retail", "recurring"]}
    return {"source_sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(), "status": "SOURCE PREVIEW ONLY; use the authorized SQL preview for current before/after values", "record_count": len(records), "network_totals": totals,
            "network_totals_display": {k: str(v.quantize(Decimal(".01"), rounding=ROUND_HALF_UP)) for k, v in totals.items()},
            "daily_goals": list(records.values()), "labor": labor,
            "membership": {"daily_growth": 2, "baseline_status": "Unverified for all sites; no baselines supplied by workbook"}}


if __name__ == "__main__":
    print(json.dumps(preview(sys.argv[1]), default=str, indent=2))
