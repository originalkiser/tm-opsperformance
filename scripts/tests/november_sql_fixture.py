"""Fictional budgets for isolated SQL tests; no workbook or production data."""
import datetime
from decimal import Decimal
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prepare_november_import import EXISTING, MISSING, prepare

sites = sorted(EXISTING | MISSING)
daily = [{'site_code': site, 'business_date': str(datetime.date(2026, 11, day)),
          'total': Decimal('1.000001'), 'retail': Decimal('.250001'), 'recurring': Decimal('.75')}
         for site in sites for day in range(1, 31)]
source = {'source_sha256': 'fictional', 'daily_goals': daily,
          'network_totals_display': {'total': '600.00', 'retail': '150.00', 'recurring': '450.00'},
          'network_totals': {'total': Decimal('600.000600'), 'retail': Decimal('150.000600'), 'recurring': Decimal('450')},
          'labor': [{'site_code': site, 'effective_month': '2026-11-01',
                     'weekly_hours': None if site in ['1508', '1511'] else Decimal(100),
                     'weekly_hours_with_manager': None if site in ['1508', '1511'] else Decimal(145),
                     'full_service_labor_percentage': Decimal('.2') if site in ['1508', '1511'] else None} for site in sites]}

if __name__ == '__main__':
    plan, preview_sql, sql = prepare(source, json.loads(sys.argv[1]) if len(sys.argv)>1 else {}, '600.00')
    print(json.dumps({'plan': plan, 'preview_sql': preview_sql, 'sql': sql}, default=str))
