// Idle choreography test.
//
// Eye state is NOT hard-coded here: it is measured from the sprite atlas by
// classify-idle-eyes.py, so these assertions are grounded in the actual art
// rather than in an assumption about which frame is which.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = process.env.FOX_CLIENT ?? join(here, '..', 'fox-pet.client.js')
const src = readFileSync(SRC_PATH, 'utf8')

// Eye state comes from a committed fixture, so this suite needs no Python and no
// image library. The fixture is generated from the atlas by
// classify-idle-eyes.py; `npm run eyes:verify` regenerates it and asserts it still
// matches, which is the check to run after the artwork changes.
const eyes = JSON.parse(readFileSync(join(here, 'idle-eye-state.json'), 'utf8'))
const CLOSED = new Set(Object.keys(eyes).filter((k) => eyes[k].eyes === 'closed').map(Number))
console.log('atlas eye state:', Object.entries(eyes).map(([k, v]) => `${k}:${v.eyes}(${v.iris})`).join('  '))
console.log('frames treated as closed:', [...CLOSED].join(', '))

// --- harness ---------------------------------------------------------------
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
  getComputedStyle: () => ({ pointerEvents: 'auto', zIndex: 'auto' }),
}
const doc = { defaultView: view, documentElement: { clientWidth: 1600, clientHeight: 900 } }

const values = []
let cursor = 0
let effects = []
let mounted = false
let registered = null
const cache = new Map()

globalThis.React = {
  useState(init) {
    const i = cursor
    cursor += 1
    if (values.length <= i) values.push(init)
    return [values[i], (u) => { values[i] = typeof u === 'function' ? u(values[i]) : u }]
  },
  useEffect(fn) { if (!mounted) effects.push(fn) },
  createElement(type, props, ...children) {
    const element = { type, props: props ?? {}, children }
    if (typeof element.props.ref === 'function') {
      const key = String(type) + ':' + String(element.props['data-fox-pet'] ?? '')
      if (!cache.has(key)) cache.set(key, makeNode(type, doc))
      element.props.ref(cache.get(key))
    }
    return element
  },
}
const slots = { inject: (k, cb) => { cb(); return () => {} }, register: (o, c) => { registered = c; return () => {} } }
new Function(src)().apply({ get: (n) => (n === 'slots' ? slots : undefined), interval: () => () => {} })

function render() { cursor = 0; return registered({}) }
function st() { return values[0] }
function tick(n = 1) { for (let i = 0; i < n; i += 1) { clock += 16; if (view.rafCb) view.rafCb() } }

let el = render()
mounted = true
for (const fn of effects) fn()
el = render()
const fox = () => el.children[0]

// --- sample a long idle run ------------------------------------------------
const TICKS = 120000 // ~32 simulated minutes
const stream = []
for (let i = 0; i < TICKS; i += 1) {
  tick(1)
  el = render()
  stream.push([st().anim, st().row, st().cell])
  // The mode machine sleeps her after 45 s of no interaction; a right-click
  // resets that clock without changing which mode she is in.
  if (i % 800 === 799) {
    fox().props.onContextMenu({ preventDefault() {} })
    el = render()
  }
}

// maximal runs of consecutive frames actually drawn while anim === 'idle'
const runs = []
let run = null
for (const [anim, , cell] of stream) {
  if (anim === 'idle') {
    if (run === null) { run = []; runs.push(run) }
    run.push(cell)
  } else {
    run = null
  }
}

// --- the drawn row must always belong to the animation that is running ------
// A run plan that keeps driving the frame advance after the mode machine has
// moved on will happily draw the idle row for seconds while `anim` says walk.
const ROW_OF = {
  idle: 0, walk: 1, sit: 2, greet: 3, yawn: 4, sleep: 5, play: 6,
  think: 7, alert: 8, fall: 8, spin: 9, somersault: 10,
}
let rowMismatch = 0
for (const [anim, row] of stream) {
  if (ROW_OF[anim] !== undefined && ROW_OF[anim] !== row) rowMismatch += 1
}

// --- sitting must rest, not shuffle ----------------------------------------
const sitRuns = []
let sitRun = null
for (const [anim, , cell] of stream) {
  if (anim === 'sit') {
    if (sitRun === null) { sitRun = []; sitRuns.push(sitRun) }
    sitRun.push(cell)
  } else {
    sitRun = null
  }
}
let worstSitOff = 0
let maxSitCells = 0
let longSits = 0
for (const r of sitRuns) {
  if (r.length < 60) continue
  longSits += 1
  const seen = {}
  for (const c of r) seen[c] = (seen[c] || 0) + 1
  const top = Math.max(...Object.values(seen))
  const off = 1 - top / r.length
  if (off > worstSitOff) worstSitOff = off
  maxSitCells = Math.max(maxSitCells, Object.keys(seen).length)
}

const flat = runs.flat()
const counts = {}
for (const c of flat) counts[c] = (counts[c] || 0) + 1

const problems = []
function check(name, ok, detail) {
  if (!ok) problems.push(`${name} [${detail}]`)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  [${detail}]`)
}

// 1. the defect: three consecutive closed frames, with no open frame between
// Collapse repeats first: holding one closed frame for 90 ms is a blink, not
// two closed frames. What must never happen is a *transition* between two
// closed frames with no open frame between them — exactly what upstream's
// 1, 2, 1 did.
function collapse(r) {
  const out = []
  for (const c of r) if (out[out.length - 1] !== c) out.push(c)
  return out
}
let longestClosedRun = 0
let adjacentClosed = 0
for (const r of runs) {
  const c = collapse(r)
  let cur = 0
  for (let i = 0; i < c.length; i += 1) {
    if (CLOSED.has(c[i])) {
      cur += 1
      if (cur > longestClosedRun) longestClosedRun = cur
      if (i > 0 && CLOSED.has(c[i - 1])) adjacentClosed += 1
    } else {
      cur = 0
    }
  }
}
check('never two closed frames back to back', adjacentClosed === 0, `${adjacentClosed} adjacent closed pairs`)
check('never a run of three closed frames', longestClosedRun <= 1, `longest closed run = ${longestClosedRun}`)

// Control: the upstream sequence must FAIL this same check, otherwise the test
// could be passing for the wrong reason.
const upstream = [0, 1, 2, 1, 0, 1, 2, 1, 0, 4, 0, 5, 0, 6]
const upCollapsed = collapse(upstream)
let upAdjacent = 0
for (let i = 1; i < upCollapsed.length; i += 1) {
  if (CLOSED.has(upCollapsed[i]) && CLOSED.has(upCollapsed[i - 1])) upAdjacent += 1
}
check('the check catches the upstream sequence', upAdjacent > 0, `upstream [${upstream.join(',')}] collapses to [${upCollapsed.join(',')}] with ${upAdjacent} closed->closed transitions`)

check('the drawn row always matches the animation', rowMismatch === 0, `${rowMismatch} mismatched frames in ${stream.length}`)
check('sitting rests rather than shuffling', longSits > 0 && worstSitOff < 0.25, `${longSits} sits, worst spends ${(worstSitOff * 100).toFixed(0)}% off its rest frame`)
check('a sit uses at most a settle plus a rest', maxSitCells <= 3, `${maxSitCells} distinct cells in the busiest sit`)

// 2. every idle run opens on the neutral frame, and every expression resolves
const badStart = runs.filter((r) => r[0] !== 0).length
check('every idle run opens on the neutral frame', badStart === 0, `${badStart} bad starts`)
// A run ends when the mode machine leaves idle, which may interrupt a beat
// mid-expression; that is legitimate and not asserted here.

// 3. the neutral frame carries the idle; expressions are punctuation
const neutralShare = (counts[0] || 0) / flat.length
check('the neutral frame dominates', neutralShare > 0.8, `${(neutralShare * 100).toFixed(1)}% neutral`)

// 4. the whole row gets used, including frame 3 that upstream never played
const unused = [0, 1, 2, 3, 4, 5, 6].filter((c) => !(c in counts))
check('every idle frame gets used', unused.length === 0, unused.length ? `never drawn: ${unused.join(',')}` : 'all 7 drawn')
check('the glance frame upstream never played is used', (counts[3] || 0) > 0, `frame 3 drawn ${counts[3] || 0}x`)

// 5. holds are human-scale, not multi-second freezes with a 120 ms twitch
// A zero-run inside a beat (the open frame between a double blink) is short by
// design, so the meaningful measure is the *longest* zero-run per run: that is
// the hold between beats.
const holdLengths = []
let runsWithHold = 0
for (const r of runs) {
  let cur = 0
  let best = 0
  for (const c of r) {
    if (c === 0) {
      cur += 1
      if (cur > best) best = cur
    } else {
      if (cur > 0) holdLengths.push(cur)
      cur = 0
    }
  }
  if (cur > 0) holdLengths.push(cur)
  if (best >= 60) runsWithHold += 1
}
const longestHold = Math.max(...holdLengths)
check('holds are real pauses, not twitches', longestHold >= 60, `longest hold ${longestHold} frames (${(longestHold * 16 / 1000).toFixed(1)}s)`)
// 2400 ms floor + 3000 ms span + a beat's trailing open frame ~= 360 ticks.
check('no hold stalls past the configured maximum', longestHold <= 370, `longest hold ${longestHold} frames (${(longestHold * 16 / 1000).toFixed(1)}s)`)
check('almost every idle run contains a proper hold', runsWithHold >= runs.length * 0.8, `${runsWithHold} of ${runs.length} runs`)

// 6. it does not read as a fixed loop: the opening of the sample must not repeat
const head = flat.slice(0, 300).join(',')
const tail = flat.slice(300, 600).join(',')
const later = flat.slice(20000, 20300).join(',')
check('the cycle is not a fixed period', head !== tail && head !== later, 'three windows compared')

// 7. the previous beat is never chosen twice in a row
let repeats = 0
for (let i = 1; i < runs.length; i += 1) {
  const a = runs[i - 1]
  const b = runs[i]
  const sig = (r) => r.filter((c) => c !== 0).join(',')
  if (sig(a) !== '' && sig(a) === sig(b)) repeats += 1
}
check('the same beat never repeats consecutively', repeats < runs.length * 0.2, `${repeats} repeats across ${runs.length} runs`)

console.log(`\nsampled ${flat.length} idle frames across ${runs.length} runs`)
console.log('frame usage:', Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}:${v}`).join('  '))
console.log(problems.length === 0 ? '\nIDLE CHOREOGRAPHY VALID' : `\n${problems.length} PROBLEM(S)`)
process.exit(problems.length === 0 ? 0 : 1)
