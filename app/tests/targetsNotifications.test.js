import test from 'node:test'
import assert from 'node:assert/strict'
import { locationHelpHarness } from './helpers/locationHelpHarness.js'
import { findMissingTargets, inProactiveWindow, targetReminderMonths } from '../src/utils/targetsNotifications.js'

const date = (year, month, day, hour = 0) => new Date(year, month - 1, day, hour)
const site = { id: 'active', name: 'Active location', site_code: '1510', show_budget_tracking: true }
const target = (month, location_id = site.id) => ({ location_id, target_month: month })

test('upcoming reminders start at local midnight on the final weekday of a month', () => {
  for (const [year, month, finalWeekday, lastDay] of [
    [2026, 11, 30, 30], [2026, 10, 30, 31], [2027, 1, 29, 31],
    [2026, 2, 27, 28], [2028, 2, 29, 29], [2032, 2, 27, 29], [2026, 12, 31, 31],
  ]) {
    assert.equal(inProactiveWindow(date(year, month, finalWeekday - 1, 23)), false)
    for (let day = finalWeekday; day <= lastDay; day++) {
      assert.equal(inProactiveWindow(date(year, month, day)), true)
    }
    assert.equal(inProactiveWindow(date(year, month + 1, 1)), false)
  }
})

test('December’s upcoming reminder becomes January’s current reminder and clears when saved', () => {
  const december = target('2026-12-01')
  const january = target('2027-01-01')
  assert.deepEqual(targetReminderMonths(date(2026, 12, 31)), [december.target_month, january.target_month])
  const missing = (day, rows) => findMissingTargets([site], rows, day).map(({ month, reason }) => [month, reason])
  assert.deepEqual(missing(date(2026, 12, 30), [december]), [])
  assert.deepEqual(missing(date(2026, 12, 31), [december]), [[january.target_month, 'upcoming']])
  assert.deepEqual(missing(date(2027, 1, 1), [december]), [[january.target_month, 'current']])
  assert.deepEqual(missing(date(2027, 1, 15), [december]), [[january.target_month, 'current']])
  assert.deepEqual(missing(date(2027, 1, 15), [december, january]), [])
})

test('current reminders remain visible and reporting exclusions never reach the banner or bell data', () => {
  const locations = [
    site,
    { ...site, id: 'inactive', exclude_from_reporting: true },
    { ...site, id: 'sold', exclude_from_reporting: true },
    { ...site, id: 'test-only', exclude_from_reporting: true },
    { ...site, id: 'disabled', show_budget_tracking: false },
    { ...site, id: 'mesquite', site_code: 1509 },
  ]
  const missing = (day, targets = []) => findMissingTargets(locations, targets, day).map(({ location, reason }) => [location.id, reason])
  assert.deepEqual(missing(date(2026, 10, 29)), [['active', 'current']])
  assert.deepEqual(missing(date(2026, 10, 30)), [['active', 'current'], ['active', 'upcoming']])
  assert.deepEqual(missing(date(2026, 10, 31), [target('2026-11-01')]), [['active', 'current']])
  assert.deepEqual(missing(date(2026, 10, 31), [target('2026-10-01'), target('2026-11-01')]), [])
})

test('banner and bell share the timing and keep the open target form after a save refresh', () => {
  const completed = [target('2026-10-01')]
  const locations = [site, { ...site, id: 'hidden', exclude_from_reporting: true }]
  let missing = findMissingTargets(locations, completed, date(2026, 10, 29))
  const scope = 'admin'
  const Modal = () => null
  const args = {
    useMissingTargets: () => ({ missing, scope, refetch() {}, loading: false }),
    SetTargetsModal: Modal,
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
  }
  const banner = locationHelpHarness('components/TargetsBanner', args)
  const bell = locationHelpHarness('components/TargetsBell', args)
  const trigger = h => h.find(node => node.type === 'button' && node.props.title === 'Sites needing budget targets')
  assert.equal(banner.find(node => node.props?.children === 'Set Targets'), undefined)
  assert.equal(trigger(bell), undefined)
  missing = findMissingTargets(locations, completed, date(2026, 10, 30))
  assert.ok(banner.find(node => node.props?.children === 'Set Targets'))
  assert.equal(bell.find(node => node.props?.className?.includes('bg-red-500')).props.children, 1)
  trigger(bell).props.onClick()
  bell.find(node => node.type === 'button' && Array.isArray(node.props.children)
    && node.props.children[1]?.props.children === 'Next month').props.onClick()
  banner.find(node => node.props?.children === 'Set Targets').props.onClick()
  missing = findMissingTargets(locations, [...completed, target('2026-11-01')], date(2026, 10, 30))
  assert.equal(trigger(bell), undefined)
  assert.equal(banner.find(node => node.props?.children === 'Set Targets'), undefined)
  assert.equal(bell.find(node => node.type === Modal).props.missing.length, 1)
  assert.equal(banner.find(node => node.type === Modal).props.missing.length, 1)
  banner.unmount()
  bell.unmount()
})
