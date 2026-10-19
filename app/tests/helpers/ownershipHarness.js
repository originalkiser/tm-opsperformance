import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'

// Execute the real JSX and event handlers with deterministic hooks, clock and API.
export function ownershipHarness(file, props, globals = {}, exportName = 'default') {
  let cursor, pending, tree, dirty = true
  const hooks = []
  const useState = initial => {
    const i = cursor++
    if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial
    return [hooks[i], value => {
      const next = typeof value === 'function' ? value(hooks[i]) : value
      if (!Object.is(hooks[i], next)) { hooks[i] = next; dirty = true }
    }]
  }
  const useEffect = (fn, deps) => {
    const i = cursor++, old = hooks[i]
    if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) {
      pending.push(() => { old?.cleanup?.(); hooks[i] = { deps, cleanup: fn() } })
    }
  }
  const source = readFileSync(new URL(`../../src/components/${file}.jsx`, import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '')
    + (exportName === 'EditModal' ? '\nexport { EditModal }' : '')
  const mod = { exports: {} }
  const bindings = { React, useState, useEffect, useMemo: fn => fn(), ...globals }
  new Function('module', 'exports', ...Object.keys(bindings), transformSync(source, { loader: 'jsx', format: 'cjs' }).code)(mod, mod.exports, ...Object.values(bindings))
  const render = () => {
    do { dirty = false; cursor = 0; pending = []; tree = mod.exports[exportName](props); pending.forEach(fn => fn()) } while (dirty)
    return tree
  }
  const nodes = value => value == null || typeof value !== 'object' ? [] : [value, ...React.Children.toArray(value.props?.children).flatMap(nodes)]
  return {
    render,
    find: predicate => nodes(render()).find(predicate),
    all: predicate => nodes(render()).filter(predicate),
    props: value => { props = value; dirty = true; render() },
    async flush() { for (let i = 0; i < 5; i++) { await Promise.resolve(); render() } },
    unmount() { hooks.forEach(hook => hook?.cleanup?.()) },
  }
}

export function ownershipApi({ posts = [], goals = {} } = {}) {
  const writes = [], reads = [], deferred = []
  const client = { from(table) {
    const filters = [], request = { table, filters }
    const load = () => {
      reads.push(request)
      const location = filters.find(([key]) => key === 'location_id')?.[1]
      const date = filters.find(([key]) => key === 'log_date')?.[1]
      const data = table === 'ownership_wash_goals' ? goals[location] || null
        : posts.filter(row => row.location_id === location && (!date || row.log_date === date))
      if (client.defer) return new Promise(resolve => deferred.push({ ...request, resolve }))
      return Promise.resolve({ data: request.single && Array.isArray(data) ? data[0] || null : data })
    }
    const query = {
      select() { return query }, eq(key, value) { filters.push([key, value]); return query }, order() { return query },
      limit: load, maybeSingle() { request.single = true; return load() },
      upsert(payload) { writes.push({ table, payload }); return Promise.resolve({}) },
      update(payload) { request.payload = payload; return query }, insert(payload) { request.payload = payload; return query },
      single() {
        writes.push({ table, payload: request.payload, filters })
        goals[request.payload.location_id] = { ...request.payload, updated_at: 'saved' }
        return Promise.resolve({ data: goals[request.payload.location_id] })
      },
    }
    return query
  } }
  return { client, writes, reads, deferred, goals }
}
