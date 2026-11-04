"""Generate private review artifacts only. No database connection or execution.

Usage: python3 scripts/prepare_november_import.py WORKBOOK OUTPUT_DIRECTORY
       --expected-total AMOUNT [--baselines VERIFIED_BASELINES_JSON]

Baseline JSON: {"SITE": {"starting_members": INTEGER, "verified": true,
"evidence": "authoritative opening-count evidence"}}. Supplied official balances
replace existing November membership values regardless of their previous values.
The reviewed row inventory, mappings, locks and reconciliation remain guarded.
"""
import argparse
from decimal import Decimal
import json
from pathlib import Path
from preview_november_budget import preview

EXISTING = {'1512', '1515', '1521', '1522', '1524', '1525', '1526', '1527', '1528', '1529'}
MISSING = {'1508', '1511', '1516', '1517', '1518', '1519', '1520', '1530', '1531', '1532'}


def literal(value):
    if value is None:
        return 'null'
    return "'" + str(value).replace("'", "''") + "'"


def prepare(source, baselines, expected_total, expected_starting_total=None, expected_eom_total=None):
    if Decimal(source['network_totals_display']['total']) != Decimal(expected_total):
        raise ValueError('Network total differs from approved control')
    sites = {r['site_code'] for r in source['daily_goals']}
    if sites != EXISTING | MISSING or len(source['daily_goals']) != 600:
        raise ValueError('Expected exactly the approved twenty sites and 600 records')
    if set(baselines) - sites:
        raise ValueError('Unexpected baseline site')
    for site, row in baselines.items():
        if row.get('verified') is not True or type(row.get('starting_members')) is not int or not 0 <= row['starting_members'] <= 2147483587 or not isinstance(row.get('evidence'), str) or not row['evidence'].strip():
            raise ValueError('Baseline requires a verified nonnegative integer and evidence: ' + site)
    starting_total = sum(row['starting_members'] for row in baselines.values()) if len(baselines) == 20 else None
    eom_total = starting_total + 1200 if starting_total is not None else None
    for actual, expected in [(starting_total, expected_starting_total), (eom_total, expected_eom_total)]:
        if expected is not None and actual != expected:
            raise ValueError('Membership network control mismatch or incomplete baselines')
    by_site = {site: sum(Decimal(str(r['total'])) for r in source['daily_goals'] if r['site_code'] == site) for site in sites}
    monthly = []
    for labor in source['labor']:
        site = labor['site_code']
        baseline = baselines.get(site)
        action = 'update authoritative November targets' if site in EXISTING and baseline else 'update revenue/labor only' if site in EXISTING else 'insert' if baseline else 'defer: verified opening baseline required'
        monthly.append({**labor, 'revenue_goal': by_site[site], 'action': action,
                        'starting_members': baseline['starting_members'] if baseline else 'preserve existing' if site in EXISTING else None,
                        'membership_daily_growth': 2 if baseline else 'preserve existing' if site in EXISTING else None,
                        'membership_goal': baseline['starting_members'] + 60 if baseline else 'preserve existing' if site in EXISTING else None})
    plan = {'source_sha256': source['source_sha256'], 'daily_records': 600,
            'network_totals': source['network_totals'], 'network_totals_display': source['network_totals_display'],
            'monthly_updates': 10, 'monthly_inserts': len(MISSING & set(baselines)),
            'monthly_deferred': sorted(MISSING - set(baselines)), 'monthly': monthly,
            'membership_starting_total': starting_total, 'membership_eom_total': eom_total,
            'membership_growth_total': eom_total - starting_total if starting_total is not None else None,
            'membership_authoritative_sites': sorted(baselines),
            'existing_baselines': 'Official supplied balances replace existing November counts, growth and EOM goals. Unrelated fields remain unchanged.',
            'labor_semantics': 'Confirmed: Express weekly hours exclude the salaried manager; with-manager hours add 45. Full-service sites use percentage budgets.'}
    daily_values = ',\n'.join('(' + ','.join(literal(r[k]) for k in ['site_code', 'business_date', 'total', 'retail', 'recurring']) + ')' for r in source['daily_goals'])
    monthly_values = ',\n'.join('(' + ','.join(literal(v) for v in [r['site_code'], r['weekly_hours'] or 0,
        r['weekly_hours_with_manager'] or 0, r['full_service_labor_percentage'], by_site[r['site_code']], r['site_code'] in EXISTING]) + ')' for r in source['labor'])
    baseline_values = ',\n'.join('(' + ','.join(literal(v) for v in [site, row['starting_members'], row['evidence']]) + ')' for site, row in sorted(baselines.items()))
    baseline_select = ('values ' + baseline_values) if baseline_values else 'select null::text, null::integer, null::text where false'
    monthly_ctes = f"""monthly(site, hours, hours_with_manager, percentage, revenue_goal, was_existing) as (
  values {monthly_values}
), baselines(site, starting_members, evidence) as ({baseline_select})"""
    ctes = f"daily(site, business_date, total_goal, retail_goal, recurring_goal) as (values {daily_values}),\n{monthly_ctes}"
    # All private source values are quoted, then explicitly cast by SQL. None are
    # interpolated as executable identifiers or expressions.
    snapshot = f"""with {monthly_ctes}
select m.site, l.id as location_id,
 case when t.location_id is not null then 'UPDATE authoritative November targets'
      when b.site is not null then 'INSERT with verified baseline'
      else 'DEFER: verified baseline required' end as action,
 to_jsonb(t) as existing_target,
 jsonb_build_object('revenue_goal', m.revenue_goal, 'weekly_hours', m.hours,
  'weekly_hours_with_manager', m.hours_with_manager, 'labor_percentage', m.percentage,
  'starting_members', b.starting_members::integer, 'membership_daily_growth', case when b.site is not null then 2 end,
  'membership_goal', b.starting_members::integer+60) as proposed_budget,
 b.evidence,
 (t.starting_members,t.membership_daily_growth,t.membership_goal) is distinct from
 (b.starting_members::integer,2,b.starting_members::integer+60) as membership_values_change,
 case when l.id is null or l.show_budget_tracking is not true or coalesce(l.exclude_from_reporting,false) then 'STOP: location state changed'
      when m.was_existing::boolean <> (t.location_id is not null) then 'STOP: target inventory changed'
      else 'MATCHES reviewed inventory; authoritative values will replace current goals' end as current_state_check
from monthly m
left join public.locations l on split_part(l.site_code, '-', 1) = m.site
left join public.budget_targets t on t.location_id=l.id and t.target_month=date '2026-11-01'
left join baselines b on b.site=m.site order by m.site;"""
    preview_sql = "-- READ ONLY: private before/after preview; confirm project qbdvixxooofdlfurcpqy.\nbegin transaction read only;\n" + snapshot + "\nrollback;\n"
    template = Path(__file__).with_name('sql').joinpath('november_budget_import.sql').read_text()
    apply_sql = template.replace('/* SOURCE_CTES */', ctes)
    apply_sql = apply_sql.replace('/* TOTAL_CONTROL */', literal(source['network_totals']['total']))
    apply_sql = apply_sql.replace('/* SOURCE_HASH */', literal(source['source_sha256']))
    apply_sql = apply_sql.replace('/* MEMBERSHIP_START_CONTROL */', literal(starting_total))
    apply_sql = apply_sql.replace('/* MEMBERSHIP_EOM_CONTROL */', literal(eom_total))
    return plan, preview_sql, apply_sql


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workbook')
    parser.add_argument('output_directory')
    parser.add_argument('--expected-total', required=True)
    parser.add_argument('--baselines')
    parser.add_argument('--expected-starting-members', type=int)
    parser.add_argument('--expected-eom-members', type=int)
    args = parser.parse_args()
    destination = Path(args.output_directory).resolve()
    repository = Path(__file__).resolve().parents[1]
    if destination == repository or repository in destination.parents:
        raise ValueError('Private output directory must be outside the repository')
    baselines = json.loads(Path(args.baselines).read_text()) if args.baselines else {}
    plan, preview_sql, apply_sql = prepare(preview(args.workbook), baselines, args.expected_total,
                                         args.expected_starting_members, args.expected_eom_members)
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name, text in [('preview.json', json.dumps(plan, default=str, indent=2)), ('preview-READ-ONLY.sql', preview_sql), ('import-REVIEW-ONLY.sql', apply_sql)]:
        path = destination / name
        if path.exists():
            raise ValueError('Refusing to overwrite an existing review artifact: ' + str(path))
        path.touch(mode=0o600)
        path.write_text(text)
    print(json.dumps({k: plan[k] for k in ['daily_records', 'monthly_updates', 'monthly_inserts', 'monthly_deferred',
                                         'membership_starting_total', 'membership_eom_total']}))


if __name__ == '__main__':
    main()
