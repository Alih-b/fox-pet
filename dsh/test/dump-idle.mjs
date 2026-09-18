// Dump the real drawn sequence (cell + duration) so idle can be judged as the
// eye sees it, not as the state machine describes it.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(process.env.FOX_CLIENT ?? join(here, '..', 'fox-pet.client.js'), 'utf8')

let clock = 1000000
Date.now = () => clock
function makeNode(tag, doc) {
  return {
    tagName: String(tag).toUpperCase(), ownerDocument: doc, style: {}, _listeners: {},
    addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f) },
    removeEventListener() {},
    getBoundingClientRect: () => ({ width: 1600, height: 900, x: 0, y: 0 }),
    setAttribute() {}, getAttribute() { return null }, contains() { return false },
  }
}
const view = {
  rafCb: null,
  requestAnimationFrame(cb) { view.rafCb = cb; return 1 },
  cancelAnimationFrame() { view.rafCb = null },
  ResizeObserver: class { constructor(cb) { this.cb = cb } observe() {} disconnect() {} },
  getComputedStyle: () => ({}),
}
const doc = { defaultView: view, documentElement: { clientWidth: 1600, clientHeight: 900 } }
const values = []
let cursor = 0
let effects = []
let mounted = false
let registered = null
const cache = new Map()
globalThis.React = {
  useState(i) { const k = cursor++; if (values.length <= k) values.push(i); return [values[k], (u) => { values[k] = typeof u === 'function' ? u(values[k]) : u }] },
  useEffect(f) { if (!mounted) effects.push(f) },
  createElement(type, props, ...children) {
    const el = { type, props: props ?? {}, children }
    if (typeof el.props.ref === 'function') {
      const key = String(type) + ':' + String(el.props['data-fox-pet'] ?? '')
      if (!cache.has(key)) cache.set(key, makeNode(type, doc))
      el.props.ref(cache.get(key))
    }
    return el
  },
}
const slots = { inject: (k, cb) => { cb(); return () => {} }, register: (o, c) => { registered = c; return () => {} } }
new Function(src)().apply({ get: (n) => (n === 'slots' ? slots : undefined), interval: () => () => {} })
function render() { cursor = 0; return registered({}) }
function st() { return values[0] }
function tick(n = 1) { for (let i = 0; i < n; i += 1) { clock += 16; if (view.rafCb) view.rafCb() } }

let el = render()
mounted = true
for (const f of effects) f()
el = render()
const fox = () => el.children[0]

const TICKS = 9000 // ~144 s
const samples = []
for (let i = 0; i < TICKS; i += 1) {
  tick(1)
  el = render()
  samples.push([st().anim, st().row, st().cell])
  if (i % 800 === 799) { fox().props.onContextMenu({ preventDefault() {} }); el = render() }
}

// run-length encode
const runs = []
for (const s of samples) {
  const key = s.join('/')
  const last = runs[runs.length - 1]
  if (last && last.key === key) last.ms += 16
  else runs.push({ key, ms: 16, anim: s[0], row: s[1], cell: s[2] })
}

console.log(`first ${TICKS} ticks (~${(TICKS * 16 / 1000).toFixed(0)}s) as drawn:`)
for (const r of runs.slice(0, 70)) {
  const bar = '#'.repeat(Math.min(60, Math.round(r.ms / 40)))
  console.log(`  ${String(r.ms).padStart(5)}ms  ${r.anim.padEnd(5)} row${r.row} cell${r.cell}  ${bar}`)
}
console.log(`\n(${runs.length} runs total)`)
const cells = {}
for (const r of runs) if (r.anim === 'idle') cells[r.cell] = (cells[r.cell] || 0) + 1
console.log('idle runs per cell:', JSON.stringify(cells))
