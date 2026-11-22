import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/hooks/useDarkMode.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/m, '')
  .replace('export function', 'function')

function appearanceHarness(entries = {}, { blocked = false } = {}) {
  const storage = new Map(Object.entries(entries))
  const listeners = new Set()
  const classes = new Set()
  const states = []
  const dependencies = []
  let cursor, effects
  const media = {
    matches: false,
    addEventListener: (_, handler) => listeners.add(handler),
    removeEventListener: (_, handler) => listeners.delete(handler),
  }
  const window = {
    matchMedia: query => {
      assert.equal(query, '(prefers-color-scheme: dark)')
      return media
    },
    get localStorage() {
      if (blocked) throw new Error('Storage denied')
      return { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }
    },
  }
  const document = {
    documentElement: { classList: { toggle: (key, on) => on ? classes.add(key) : classes.delete(key) } },
    querySelector: () => null,
  }
  function useState(initial) {
    const index = cursor++
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
    return [states[index], next => { states[index] = next }]
  }
  function useEffect(fn, deps) {
    const index = cursor++
    if (!dependencies[index] || deps.some((value, i) => !Object.is(value, dependencies[index][i]))) {
      dependencies[index] = deps
      effects.push(fn)
    }
  }
  const useDarkMode = new Function('window', 'document', 'useState', 'useEffect', 'useLayoutEffect',
    source + '\nreturn useDarkMode')(window, document, useState, useEffect, useEffect)
  return {
    storage, classes,
    render() {
      cursor = 0
      effects = []
      const result = useDarkMode()
      effects.forEach(effect => effect())
      return result
    },
    system(dark) {
      media.matches = dark
      listeners.forEach(update => update())
    },
  }
}

test('System is the default and tracks OS changes; manual choices persist and override the OS', () => {
  const h = appearanceHarness()
  const [dark, select, appearance] = h.render()
  assert.equal(dark, false)
  assert.equal(appearance, 'system')
  h.system(true)
  assert.equal(h.render()[0], true)
  assert.ok(h.classes.has('dark'))
  select('light')
  assert.equal(h.render()[0], false)
  assert.equal(h.storage.get('tm_appearance'), 'light')
  assert.equal(appearanceHarness(Object.fromEntries(h.storage)).render()[2], 'light')
  h.system(false)
  select('dark')
  assert.equal(h.render()[0], true)
  assert.equal(h.storage.get('tm_appearance'), 'dark')
  select('system')
  assert.equal(h.render()[0], false)
  h.system(true)
  assert.equal(h.render()[0], true)
})

test('legacy preferences migrate once and a saved System choice takes precedence', () => {
  for (const [legacy, expected] of [['true', 'dark'], ['false', 'light']]) {
    const h = appearanceHarness({ tm_dark_mode: legacy })
    assert.equal(h.render()[2], expected)
    assert.equal(h.storage.get('tm_appearance'), expected)
  }
  assert.equal(appearanceHarness({ tm_dark_mode: 'true', tm_appearance: 'system' }).render()[2], 'system')
})

test('appearance remains usable with storage disabled', () => {
  const h = appearanceHarness({}, { blocked: true })
  const [, select, appearance] = h.render()
  assert.equal(appearance, 'system')
  select('dark')
  assert.equal(h.render()[0], true)
})
