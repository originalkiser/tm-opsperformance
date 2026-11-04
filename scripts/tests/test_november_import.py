"""Offline import preparation checks using fictional values only."""
import copy
import unittest
from november_sql_fixture import source
from prepare_november_import import prepare


class ImportPreparationTests(unittest.TestCase):
    def test_missing_baselines_are_deferred_not_defaulted_to_zero(self):
        plan, preview, sql = prepare(source, {}, '600.00')
        self.assertEqual(plan['monthly_updates'], 10)
        self.assertEqual(plan['monthly_inserts'], 0)
        self.assertEqual(len(plan['monthly_deferred']), 10)
        for row in plan['monthly']:
            if row['site_code'] in plan['monthly_deferred']:
                self.assertIsNone(row['starting_members'])
                self.assertIsNone(row['membership_goal'])
        self.assertIn('begin transaction read only', preview)
        self.assertIn("november_import_approved = 'false'", sql)
        self.assertTrue(sql.rstrip().endswith('rollback;'))
        self.assertNotIn('budget_daily_entries', sql)

    def test_baselines_require_explicit_verification_and_evidence(self):
        for baseline in [{}, {'starting_members': 100, 'verified': False, 'evidence': 'unknown'},
                         {'starting_members': -1, 'verified': True, 'evidence': 'invalid'},
                         {'starting_members': True, 'verified': True, 'evidence': 'invalid'},
                         {'starting_members': 100, 'verified': True, 'evidence': ''}]:
            with self.assertRaises(ValueError):
                prepare(source, {'1508': baseline}, '600.00')
        plan, _, _ = prepare(source, {'1508': {'starting_members': 0, 'verified': True, 'evidence': 'Verified fictional opening zero'}}, '600.00')
        self.assertEqual(plan['monthly_inserts'], 1)
        self.assertEqual(next(r for r in plan['monthly'] if r['site_code']=='1508')['membership_goal'], 60)

    def test_official_balances_replace_existing_values_without_old_count_whitelists(self):
        baseline = {'starting_members': 999, 'verified': True, 'evidence': 'Official fictional ending count'}
        plan, preview, sql = prepare(source, {'1512': baseline}, '600.00')
        row = next(r for r in plan['monthly'] if r['site_code']=='1512')
        self.assertEqual(row['starting_members'], 999)
        self.assertEqual(row['membership_daily_growth'], 2)
        self.assertEqual(row['membership_goal'], 1059)
        self.assertEqual(row['action'], 'update authoritative November targets')
        self.assertNotIn('expected_starting_members', sql)
        self.assertNotIn('approved_correction', sql)
        self.assertNotIn('STOP: existing membership state changed', preview)
        self.assertIn('target inventory changed', preview)

    def test_complete_membership_controls_are_independently_checked(self):
        sites = {r['site_code'] for r in source['daily_goals']}
        baselines = {site: {'starting_members': 100, 'verified': True, 'evidence': 'Fictional verified ending count'} for site in sites}
        plan, _, _ = prepare(source, baselines, '600.00', 2000, 3200)
        self.assertEqual(plan['membership_starting_total'], 2000)
        self.assertEqual(plan['membership_eom_total'], 3200)
        self.assertEqual(plan['membership_growth_total'], 1200)
        with self.assertRaises(ValueError):
            prepare(source, baselines, '600.00', 2001, 3200)
        with self.assertRaises(ValueError):
            prepare(source, baselines, '600.00', 2000, 3201)

    def test_wrong_controls_or_sites_stop_preparation_and_decimal_strings_remain_exact(self):
        with self.assertRaises(ValueError):
            prepare(source, {}, '601.00')
        bad = copy.deepcopy(source)
        bad['daily_goals'][0]['site_code'] = '1523'
        with self.assertRaises(ValueError):
            prepare(bad, {}, '600.00')
        _, _, sql = prepare(source, {}, '600.00')
        self.assertIn("'1.000001'", sql)


if __name__ == '__main__':
    unittest.main()
