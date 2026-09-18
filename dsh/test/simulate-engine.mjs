// Headless simulation of the Folio client engine.
// Loads the real fox-pet.client.js body, stubs React + ctx, and drives the
// 50 ms interval callback for a simulated hour while asserting invariants.
import { readFileSync } from 'node:fs'
import { assetPath } from './find-assets.mjs'

// FOX_CLIENT lets the suites run against an extracted deployed artifact,
// so what is verified is the code the browser actually received.
const SRC_PATH = process.env.FOX_CLIENT ?? new URL('../fox-pet.client.js', import.meta.url)
const src = readFileSync(SRC_PATH, 'utf8')

// Rebuild the ROWS/ANIM tables straight out of the source under test.
const start = src.indexOf('const ROWS = {')
const end = src.indexOf('\n}\n', start) + 2
const ROWS = new Function(src.slice(start, end) + '\nreturn ROWS;')()
const ANIM = {}
for (const name in ROWS) {
  const s = ROWS[name]
  const seq = s.sequence ?? Array.from({ length: s.frames }, (_, i) => i)
  ANIM[name] = { seq, once: s.once === true }
}

let states = []
let effects = []
let intervalCb = null
let registered = null

globalThis.React = {
  useState(init) {
    const i = states.length
    states.push(init)
    return [states[i], (u) => { states[i] = typeof u === 'function' ? u(states[i]) : u }]
  },
  useEffect(fn) { effects.push(fn) },
  createElement(type, props, ...children) { return { type, props, children } },
}

const slots = {
  inject(key, cb) { cb(); return () => {} },
  register(options, component) { registered = { options, component }; return () => {} },
}

const ctx = {
  get(name) { return name === 'slots' ? slots : undefined },
  interval(cb) { intervalCb = cb; return () => { intervalCb = null } },
}

const plugin = new Function(src)()
plugin.apply(ctx)
if (registered === null) throw new Error('client did not register into shell.overlay')
console.log('registered slot:', registered.options.name, '| id:', registered.options.id, '| label:', registered.options.label)

registered.component({})
effects.forEach((fn) => fn())
if (intervalCb === null) throw new Error('component did not start its interval')

const TICK = 16
const TICKS = 225000 // one simulated hour at 60 Hz
const problems = []
let sawWalk = false
let sawSit = false
let sawSleep = false
let sawYawn = false
let sawGreet = false
let sleepEnteredAtTick = null

for (let i = 0; i < TICKS; i += 1) {
  intervalCb()
  const s = states[0]
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === 'number' && !Number.isFinite(v)) problems.push(`tick ${i}: state.${k} is ${v}`)
  }
  if (s.x < 0.02 || s.x > 0.98) problems.push(`tick ${i}: x out of frame (${s.x})`)
  if (s.bottom < 0 || s.bottom > 520) problems.push(`tick ${i}: bottom out of range (${s.bottom})`)
  if (s.hop < 0) problems.push(`tick ${i}: negative hop (${s.hop})`)
  if (s.fallV < 0) problems.push(`tick ${i}: negative fall velocity (${s.fallV})`)
  if (s.bottom < 6 - 1e-6) problems.push(`tick ${i}: fell through the floor (${s.bottom})`)
  const anim = ANIM[s.anim]
  if (anim === undefined) problems.push(`tick ${i}: unknown anim ${s.anim}`)
  else if (!(s.frame >= 0 && s.frame < anim.seq.length)) problems.push(`tick ${i}: frame ${s.frame} outside ${s.anim} (len ${anim.seq.length})`)
  if (s.anim === 'walk') sawWalk = true
  if (s.anim === 'sit') sawSit = true
  if (s.anim === 'sleep') sawSleep = true
  if (s.anim === 'yawn') sawYawn = true
  if (s.anim === 'greet') sawGreet = true
  if (s.mode === 'sleep' && sleepEnteredAtTick === null) sleepEnteredAtTick = i
}

console.log('--- simulated 1 hour of ticks ---')
console.log('walk seen:', sawWalk, '| sit:', sawSit, '| yawn:', sawYawn, '| sleep:', sawSleep)
console.log('self-slept after idle at tick:', sleepEnteredAtTick, `(~${((sleepEnteredAtTick ?? 0) * TICK / 1000).toFixed(1)}s, target 45s)`)
console.log('final state:', JSON.stringify({
  x: Number(states[0].x.toFixed(3)),
  bottom: states[0].bottom,
  mode: states[0].mode,
  anim: states[0].anim,
  frame: states[0].frame,
}))
// --- the in-source table must match the canonical animation spec ------------
// assets/pet.json belongs to the repository, not to this port, so this is the
// check that a hand transcription of the atlas layout has to pass. sitRight and
// sitLeft are the same three cells mirrored, and `fall` reuses the alert art, so
// neither has an entry of its own upstream.
const spec = JSON.parse(readFileSync(assetPath('pet.json'), 'utf8'))
let atlasDrift = []
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
for (const name of Object.keys(spec.sprite.rows)) {
  const up = spec.sprite.rows[name]
  const mine = ROWS[name === 'sitRight' || name === 'sitLeft' ? 'sit' : name]
  if (mine === undefined) { atlasDrift.push(`${name}: missing from ROWS`); continue }
  if (mine.row !== up.row) atlasDrift.push(`${name}: row ${mine.row} != ${up.row}`)
  if (mine.frames !== up.frames) atlasDrift.push(`${name}: frames ${mine.frames} != ${up.frames}`)
  if (mine.fps !== up.fps) atlasDrift.push(`${name}: fps ${mine.fps} != ${up.fps}`)
  if (!same(mine.sequence, up.sequence)) atlasDrift.push(`${name}: sequence differs`)
  if (!same(mine.durations, up.durations)) atlasDrift.push(`${name}: durations differ`)
}
if (atlasDrift.length > 0) problems.push(...atlasDrift)
console.log(`${atlasDrift.length === 0 ? 'PASS' : 'FAIL'}  in-source atlas table matches pet.json  [${atlasDrift.length === 0 ? Object.keys(spec.sprite.rows).length + ' upstream rows' : atlasDrift.slice(0, 3).join('; ')}]`)

console.log(problems.length === 0 ? `INVARIANTS HOLD over ${TICKS} ticks` : `PROBLEMS (${problems.length}):\n` + problems.slice(0, 10).join('\n'))
// Exiting 0 here let a broken invariant pass `npm test` in an && chain.
process.exit(problems.length === 0 ? 0 : 1)
