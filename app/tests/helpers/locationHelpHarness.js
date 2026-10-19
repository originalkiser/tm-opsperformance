import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'

export function locationHelpHarness(path, globals = {}, props = {}, exportName = 'default') {
  const hooks = []; let cursor, queue, dirty, tree
  const useState = initial => {
    const i = cursor++
    if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial
    return [hooks[i], value => { const next = typeof value === 'function' ? value(hooks[i]) : value; if (!Object.is(next, hooks[i])) { hooks[i] = next; dirty = true } }]
  }
  const useRef = initial => { const i = cursor++; return hooks[i] ||= { current: initial } }
  const useEffect = (effect, deps) => {
    const i = cursor++, old = hooks[i]
    if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) queue.push(() => { old?.cleanup?.(); hooks[i] = { deps, cleanup: effect() } })
  }
  const source = readFileSync(new URL(`../../src/${path}.jsx`, import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
    + (exportName === 'ProtectedRoute' ? '\nexport { ProtectedRoute }' : '')
  const mod = { exports: {} }
  const bindings = { React, createContext: React.createContext, useState, useEffect, useRef, ...globals }
  new Function('module', 'exports', ...Object.keys(bindings), transformSync(source, { loader: 'jsx', format: 'cjs' }).code)(mod, mod.exports, ...Object.values(bindings))
  const render = () => { do { dirty = false; cursor = 0; queue = []; tree = mod.exports[exportName](props); queue.forEach(fn => fn()) } while (dirty); return tree }
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)]
  return {
    render, find: predicate => nodes(render()).find(predicate), all: predicate => nodes(render()).filter(predicate),
    async flush() { for (let i = 0; i < 12; i++) { await Promise.resolve(); render() } },
    props(value) { props = value; return render() },
    unmount() { hooks.forEach(hook => hook?.cleanup?.()) },
  }
}
