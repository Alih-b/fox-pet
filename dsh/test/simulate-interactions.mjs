// Interaction + physics tests for the Folio client engine.
//
// Renders the component through a React stub that also implements refs, so the
// component gets a real (fake) DOM node: that is what makes the
// requestAnimationFrame loop, the ResizeObserver and the non-passive wheel
// listener reachable. A controllable clock makes fling velocity deterministic.
import { readFileSync } from 'node:fs'

// FOX_CLIENT lets the suites run against an extracted deployed artifact,
// so what is verified is the code the browser actually received.
const SRC_PATH = process.env.FOX_CLIENT ?? new URL('../fox-pet.client.js', import.meta.url)
const src = readFileSync(SRC_PATH, 'utf8')

let clock = 1000000
Date.now = () => clock

function makeDoc() {
  const view = {
    rafCb: null,
    rafLive: false,
    requestAnimationFrame(cb) { view.rafCb = cb; view.rafLive = true; return 1 },
    cancelAnimationFrame() { view.rafLive = false; view.rafCb = null },
    ResizeObserver: class { constructor(cb) { this.cb = cb; view._ro = this } observe() {} disconnect() {} },
    getComputedStyle: () => ({ pointerEvents: 'auto', zIndex: 'auto' }),
  }
  const doc = { defaultView: view, documentElement: { clientWidth: 1600, clientHeight: 900 }, view }
  doc.createElement = (tag) => makeNode(tag, doc)
  return doc
}

function makeNode(tag, doc) {
  return {
    tagName: String(tag).toUpperCase(),
    ownerDocument: doc,
    style: {},
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn) },
    removeEventListener(type, fn) {
      const list = this._listeners[type] || []
      const i = list.indexOf(fn)
      if (i >= 0) list.splice(i, 1)
    },
    // Reflects the mutable stage, so the ResizeObserver in the component sees a
    // genuine size change when a test resizes the window. A fixed stub here hid
    // the resize clamp entirely.
    getBoundingClientRect: () => ({ width: stage.width, height: stage.height, x: 0, y: 0 }),
    setAttribute() {},
    getAttribute() { return null },
    contains() { return false },
  }
}

const doc = makeDoc()
const values = []
let cursor = 0
let effects = []
let mounted = false
let registered = null
let rootNodeRef = null
let foxNodeRef = null
// React reuses the same DOM node across renders; the stub must too, otherwise a
// listener bound in one commit would sit on a node the next commit discards.
const nodeCache = new Map()

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
    const ref = element.props.ref
    if (typeof ref === 'function') {
      const key = String(type) + ':' + String(element.props['data-fox-pet'] ?? '')
      if (!nodeCache.has(key)) nodeCache.set(key, makeNode(type, doc))
      const node = nodeCache.get(key)
      if (type === 'div' && element.props['data-fox-pet'] === 'root') rootNodeRef = node
      if (type === 'div' && element.props['data-fox-pet'] === 'fox') foxNodeRef = node
      ref(node)
    }
    return element
  },
}

const slots = {
  inject(key, cb) { cb(); return () => {} },
  register(options, component) { registered = { options, component }; return () => {} },
}
const ctx = { get: (n) => (n === 'slots' ? slots : undefined), interval() { return () => {} } }

new Function(src)().apply(ctx)

function render() { cursor = 0; return registered.component({}) }
function state() { return values[0] }
function tick(n = 1) {
  for (let i = 0; i < n; i += 1) {
    clock += 16
    if (doc.view.rafCb) doc.view.rafCb()
  }
}
// Mutable so a test can stand the pet on a different window size.
const stage = { width: 1600, height: 900 }
function rect() { return { width: stage.width, height: stage.height, x: 0, y: 0 } }

let el = render()
mounted = true
for (const fn of effects) fn()
el = render()

const results = []
function check(name, ok, detail) { results.push({ name, ok, detail }) }

function fox() { return el.children[0] }
function root() { return el }
function pointerDown(clientX, clientY, opts = {}) {
  let prevented = false
  fox().props.onPointerDown({
    button: opts.button ?? 0,
    pointerId: opts.pointerId ?? 1,
    clientX,
    clientY,
    preventDefault() { prevented = true },
    currentTarget: { getBoundingClientRect: rect, setPointerCapture() {} },
  })
  el = render()
  return prevented
}
function pointerMove(clientX, clientY, opts = {}) {
  root().props.onPointerMove({
    pointerId: opts.pointerId ?? 1,
    clientX,
    clientY,
    currentTarget: { getBoundingClientRect: rect },
  })
  el = render()
}
function pointerUp(clientX, clientY, opts = {}) {
  root().props.onPointerUp({
    pointerId: opts.pointerId ?? 1,
    clientX,
    clientY,
    currentTarget: { getBoundingClientRect: rect },
  })
  el = render()
}
function wheel(deltaY) {
  const handlers = (foxNodeRef?._listeners.wheel) ?? []
  for (const fn of handlers) fn({ deltaY, preventDefault() {} })
  el = render()
  return handlers.length
}

// --- clock ------------------------------------------------------------------
check('clock is frame-aligned via requestAnimationFrame', doc.view.rafLive === true, `rafLive=${doc.view.rafLive}`)
check('wheel listener is bound directly (non-passive path)', wheel(0) >= 1, `${(foxNodeRef?._listeners.wheel ?? []).length} wheel handler(s)`)
check('stage width measured from the root node', state().x === 0.5 && fox().props.style.transform.includes('translate3d'), String(fox().props.style.transform))
check('position is never animated through layout', fox().props.style.left === 0, `left=${JSON.stringify(fox().props.style.left)}`)
check('the walk transform is not mirrored mid-stride', fox().props.style.transform.includes('scaleX('), String(fox().props.style.transform))

// --- mouse: sleep -----------------------------------------------------------
tick(4)
wheel(120)
el = render()
check('scroll down puts her to sleep', state().mode === 'sleep', `mode=${state().mode}`)
check('sleep plays the yawn settle first', state().anim === 'yawn', `anim=${state().anim}`)
tick(200)
el = render()
check('sleep settles into the sleep loop', state().anim === 'sleep', `anim=${state().anim}`)

wheel(-120)
el = render()
check('scroll up wakes her', state().mode !== 'sleep', `mode=${state().mode}`)
check('scroll up makes her leap', state().hopV > 0, `hopV=${state().hopV}`)

// --- mouse: double click ----------------------------------------------------
tick(60)
el = render()
fox().props.onDoubleClick({ preventDefault() {} })
el = render()
check('double-click enters sleep', state().mode === 'sleep', `mode=${state().mode}`)
fox().props.onDoubleClick({ preventDefault() {} })
el = render()
check('double-click wakes her again', state().mode !== 'sleep', `mode=${state().mode}`)

// pointerdown must NOT cancel, or the browser withholds dblclick entirely
const prevented = pointerDown(800, 300, { pointerId: 7 })
pointerUp(800, 300, { pointerId: 7 })
el = render()
check('pointerdown does not cancel the event (keeps dblclick alive)', prevented === false, `preventDefault called: ${prevented}`)

// --- physics: a fling must not be greasy ------------------------------------
tick(40)
el = render()
// Recentre first: the previous version dragged her from 0.5 to 0.65 and then
// threw, so she hit the wall and the metric measured the wall rather than the
// friction. From 0.5 a maximum-speed throw stays clear of it.
fox().props.onContextMenu({ preventDefault() {} })
el = render()
pointerDown(800, 300, { pointerId: 2 })
el = render()
let flingX = 0
let flingV0 = 0
for (let i = 0; i < 2; i += 1) {
  clock += 16
  pointerMove(800 + (i + 1) * 60, 300, { pointerId: 2 })
}
el = render()
pointerUp(920, 300, { pointerId: 2 })
el = render()
flingV0 = state().vx
flingX = state().x
check('release produces a fling velocity', flingV0 > 0.05, `vx=${flingV0.toFixed(3)}`)
check('fling speed is capped', Math.abs(flingV0) <= 1.8, `vx=${flingV0.toFixed(3)}`)

let signFlips = 0
let prevSign = Math.sign(state().vx)
let maxAbsX = state().x
let stoppedAt = -1
for (let i = 0; i < 400; i += 1) {
  tick(1)
  const v = state().vx
  const sgn = Math.sign(v)
  if (sgn !== 0 && prevSign !== 0 && sgn !== prevSign) signFlips += 1
  if (sgn !== 0) prevSign = sgn
  // Only while the throw is live: once she stops, the mode machine may walk her
  // further, and that distance is not part of "the flick did not glide".
  if (v !== 0 && state().x > maxAbsX) maxAbsX = state().x
  if (stoppedAt < 0 && v === 0) stoppedAt = i
}
const travel = maxAbsX - flingX
check('fling comes to rest', stoppedAt >= 0, `stopped after ${stoppedAt} frames`)
// Exponential decay at FLING_DAMPING predicts v0/K. The model this replaced bled
// 7% of speed per 50 ms tick, which predicts 0.71*v0 - roughly four times further
// - and reflected off walls. Asserting against the configured constant is the
// real regression guard; the absolute bound is a coarse backstop.
const predicted = flingV0 / 5.5
check('fling travel matches the configured damping', Math.abs(travel - predicted) < 0.06, `travelled ${travel.toFixed(3)}, predicted ${predicted.toFixed(3)}`)
check('fling travel is short, not most of the frame', travel < 0.40, `travelled ${travel.toFixed(3)} of frame width`)
check('fling never rebounds off a wall', signFlips === 0, `${signFlips} direction reversals`)

// --- physics: the wall absorbs, it does not bounce ---------------------------
tick(30)
el = render()
pointerDown(1500, 300, { pointerId: 3 })
for (let i = 0; i < 8; i += 1) {
  clock += 16
  pointerMove(1500 + (i + 1) * 30, 300, { pointerId: 3 })
}
pointerUp(1740, 300, { pointerId: 3 })
el = render()
let wallFlips = 0
let wallPrev = Math.sign(state().vx)
for (let i = 0; i < 300; i += 1) {
  tick(1)
  const sgn = Math.sign(state().vx)
  if (sgn !== 0 && wallPrev !== 0 && sgn !== wallPrev) wallFlips += 1
  if (sgn !== 0) wallPrev = sgn
}
check('a wall absorbs the slide instead of bouncing', wallFlips === 0 && state().vx === 0, `reversals=${wallFlips} vx=${state().vx}`)
check('the fox stays inside the frame', state().x >= 0.02 && state().x <= 0.98, `x=${state().x}`)

// --- drag on a sleeping fox keeps her asleep --------------------------------
tick(30)
el = render()
fox().props.onDoubleClick({ preventDefault() {} })
el = render()
tick(200)
el = render()
check('asleep before the drag', state().mode === 'sleep', `mode=${state().mode}`)
pointerDown(800, 300, { pointerId: 5 })
for (let i = 0; i < 5; i += 1) {
  clock += 16
  pointerMove(800 + (i + 1) * 50, 300, { pointerId: 5 })
}
pointerUp(1050, 300, { pointerId: 5 })
el = render()
check('flinging a sleeping fox does not wake her', state().mode === 'sleep', `mode=${state().mode}`)
check('a sleeping fox does not slide away', state().vx === 0, `vx=${state().vx}`)


// --- middle button is the sleep gesture -------------------------------------
function ensureAwake() {
  el = render()
  if (state().mode === 'sleep') {
    fox().props.onDoubleClick({ preventDefault() {} })
    el = render()
  }
}
function middleClick(pointerId) {
  let prevented = false
  fox().props.onPointerDown({
    button: 1,
    pointerId,
    clientX: 800,
    clientY: 300,
    preventDefault() { prevented = true },
    currentTarget: { getBoundingClientRect: rect, setPointerCapture() {} },
  })
  el = render()
  return prevented
}
function translateX() {
  const m = /translate3d\((-?[0-9.]+)px/.exec(fox().props.style.transform)
  return m ? Number(m[1]) : NaN
}
function shadow() { return fox().children[0] }

ensureAwake()
tick(20)
el = render()
check('middle-click is prevented from autoscrolling', middleClick(21) === true, 'preventDefault called')
el = render()
check('middle-click puts her to sleep', state().mode === 'sleep', `mode=${state().mode}`)
middleClick(22)
el = render()
check('middle-click again wakes her', state().mode !== 'sleep', `mode=${state().mode}`)

// --- slow fall: lifted, released, drifts rather than drops ------------------
ensureAwake()
tick(20)
el = render()
pointerDown(800, 600, { pointerId: 31 })
clock += 16
pointerMove(800, 300, { pointerId: 31 })
el = render()
const liftHeight = state().bottom
check('drag lifts her off the floor', liftHeight > 250, `bottom=${liftHeight}`)
tick(30)
el = render()
check('she hangs while the pointer owns her', state().bottom === liftHeight, `bottom=${state().bottom} vs lifted ${liftHeight}`)

pointerUp(800, 300, { pointerId: 31 })
el = render()
let sawFallAnim = false
let sawSway = false
let sawShrunkShadow = false
let framesToLand = -1
const groundX = state().x * stage.width - 60
for (let i = 0; i < 1200; i += 1) {
  tick(1)
  el = render() // the sway lives in the rendered transform
  if (state().anim === 'fall') sawFallAnim = true
  if (state().bottom > 6 && Math.abs(translateX() - groundX) > 1) sawSway = true
  const shadowTransform = String(shadow().props.style.transform ?? '')
  if (state().bottom > 6 && shadowTransform !== 'scale(1)') sawShrunkShadow = true
  if (state().bottom <= 6) { framesToLand = i; break }
}
check('a dropped fox shows the airborne pose', sawFallAnim, `anim seen: fall=${sawFallAnim}`)
check('a dropped fox sways as she drifts', sawSway, `sway observed: ${sawSway}`)
check('the shadow tracks her height', sawShrunkShadow, `shadow shrank: ${sawShrunkShadow}`)
check('she reaches the floor', framesToLand >= 0, `landed after ${framesToLand} frames`)
// Free fall from 300 px at g=2600 would land in ~30 frames; the ceiling is what
// makes it a drift. Anything under 100 frames means the slow fall regressed.
check('the descent is a slow fall, not a drop', framesToLand > 100, `${framesToLand} frames (~${(framesToLand * 16 / 1000).toFixed(2)}s)`)
check('she lands exactly on the floor', state().bottom === 6, `bottom=${state().bottom}`)
check('landing from leaf fall lands softly without a bounce', state().hopV === 0 && state().hop === 0, `hopV=${state().hopV} hop=${state().hop}`)
check('landing is acknowledged with alert pose', state().action === 'alert', `action=${state().action}`)

// The impact must not rebound her off the floor. Measured on the drawn offset
// (hop) and on the spring: a damped spring released from rest at its compressed
// extreme is the smallest excursion a linear spring can make, so any velocity
// added at touchdown only deepens the stretch that follows. The bound sits just
// above the measured 1.7% so re-adding a kick fails here.
let landedRise = 0
let landedMaxOvershoot = 0
let prevBottom = state().bottom
for (let i = 0; i < 120; i += 1) {
  tick(1)
  el = render()
  const s = state()
  if (s.bottom > prevBottom + 0.01) landedRise = Math.max(landedRise, s.bottom - 6)
  if (s.squash < 0) landedMaxOvershoot = Math.min(landedMaxOvershoot, s.squash)
  prevBottom = s.bottom
}
check('the landing never lifts her off the floor', landedRise < 0.01, `rise=${landedRise.toFixed(4)} px`)
check('the landing does not rebound into a stretch', landedMaxOvershoot > -0.025, `overshoot=${landedMaxOvershoot.toFixed(3)}`)

// --- hard fling tumbles, hard wall hit somersaults --------------------------
tick(60)
ensureAwake()
el = render()
pointerDown(300, 300, { pointerId: 41 })
for (let i = 0; i < 6; i += 1) {
  clock += 16
  pointerMove(300 + (i + 1) * 90, 300, { pointerId: 41 })
}
pointerUp(840, 300, { pointerId: 41 })
el = render()
check('a hard flick turns into a spin', state().action === 'spin', `action=${state().action} vx=${state().vx.toFixed(2)}`)

tick(120)
ensureAwake()
el = render()
pointerDown(300, 300, { pointerId: 51 })
for (let i = 0; i < 6; i += 1) {
  clock += 16
  pointerMove(300 + (i + 1) * 90, 300, { pointerId: 51 })
}
pointerUp(840, 300, { pointerId: 51 })
el = render()
let wallAction = ''
for (let i = 0; i < 600; i += 1) {
  tick(1)
  if (state().action === 'somersault') { wallAction = 'somersault'; break }
  if (state().vx === 0) break
}
check('hitting a wall hard earns a somersault', wallAction === 'somersault', `action=${wallAction || state().action}`)


// --- the frame's top edge is the only limit on lifting her ------------------
// The old clamp was a hard-coded 520 px, which on a 1165 px window put her
// centre at roughly mid-screen: she could not be carried above it.
stage.width = 2285
stage.height = 1165
ensureAwake()
tick(10)
el = render()
pointerDown(1100, 900, { pointerId: 61 })
clock += 16
pointerMove(1100, -1200, { pointerId: 61 })
el = render()
const topReach = state().bottom
check('she can be carried above the middle of the frame', topReach > 1165 / 2, `bottom=${topReach} (mid=${1165 / 2})`)
check('her ears stop just short of the frame top', topReach <= 1165 - 130 - 4 + 1e-9, `bottom=${topReach} ceiling=${1165 - 130 - 4}`)
check('the whole train of travel stays reachable', topReach > 1000, `bottom=${topReach}`)
pointerUp(1100, -1200, { pointerId: 61 })
el = render()
stage.width = 1600
stage.height = 900

// --- perch: a click caught mid-fall makes that spot solid -------------------
ensureAwake()
tick(20)
el = render()
pointerDown(800, 700, { pointerId: 71 })
clock += 16
pointerMove(800, 300, { pointerId: 71 })
el = render()
const liftedTo = state().bottom
pointerUp(800, 300, { pointerId: 71 })
el = render()
tick(40)
el = render()
const caughtAt = state().bottom
check('she is genuinely mid-fall before the catch', caughtAt < liftedTo - 5 && caughtAt > 6, `bottom=${caughtAt} lifted to ${liftedTo}`)

pointerDown(800, 300, { pointerId: 72 })
el = render()
pointerUp(800, 300, { pointerId: 72 })
el = render()
check('clicking her mid-fall raises a new ground', state().ground > 6, `ground=${state().ground}`)
check('the new ground is where she was caught', Math.abs(state().ground - caughtAt) < 2, `ground=${state().ground} caught=${caughtAt}`)
check('the perch also stops her descent', state().bottom <= state().ground + 1e-9, `bottom=${state().bottom} ground=${state().ground}`)
const perched = state().ground
tick(240)
el = render()
check('she stays perched rather than drifting down', Math.abs(state().bottom - perched) < 0.5, `bottom=${state().bottom} ground=${perched}`)
check('a perched fox shows no airborne pose', state().anim !== 'fall', `anim=${state().anim}`)

pointerDown(800, 300, { pointerId: 73 })
for (let i = 0; i < 4; i += 1) { clock += 16; pointerMove(800 + (i + 1) * 60, 300, { pointerId: 73 }) }
pointerUp(1040, 300, { pointerId: 73 })
el = render()
check('dropping her again restores the default floor', state().ground === 6, `ground=${state().ground}`)
check('a purely vertical drag counts as a drag, not a click', state().ground === 6 && state().bottom > 6, `ground=${state().ground} bottom=${state().bottom}`)

// --- catching a sleeping fox mid-fall does not wake her ----------------------
tick(200)
el = render()
fox().props.onDoubleClick({ preventDefault() {} })
el = render()
check('sleeping before the lift', state().mode === 'sleep', `mode=${state().mode}`)
pointerDown(800, 700, { pointerId: 74 })
clock += 16
pointerMove(800, 300, { pointerId: 74 })
pointerUp(800, 300, { pointerId: 74 })
el = render()
// Run until she is genuinely airborne rather than guessing a tick count: the
// fall is a drift, so a fixed number of frames is not a fixed height.
let midFallTicks = -1
for (let i = 0; i < 600; i += 1) {
  tick(1)
  el = render()
  if (state().bottom < 400 && state().bottom > 40) { midFallTicks = i; break }
}
check('sleeping fox is caught genuinely mid-fall', midFallTicks >= 0, `after ${midFallTicks} ticks, bottom=${state().bottom.toFixed(1)}`)
pointerDown(800, 300, { pointerId: 75 })
el = render()
pointerUp(800, 300, { pointerId: 75 })
el = render()
check('clicking sleeping fox mid-fall perches her', state().ground > 6, `ground=${state().ground}`)
check('clicking sleeping fox mid-fall does not wake her', state().mode === 'sleep', `mode=${state().mode}`)
check('sleeping perched fox settles into the sleep loop', state().anim === 'sleep' && state().action === null, `anim=${state().anim} action=${state().action}`)

// --- pose: squash on landing, scaled about her feet -------------------------
ensureAwake()
el = render()
pointerDown(800, 700, { pointerId: 81 })
clock += 16
pointerMove(800, 250, { pointerId: 81 })
pointerUp(800, 250, { pointerId: 81 })
el = render()
let peakSquash = 0
let sawCompress = false
let sawStretch = false
for (let i = 0; i < 700; i += 1) {
  tick(1)
  el = render() // the transform is read off the rendered tree, so re-render
  if (state().squash > peakSquash) peakSquash = state().squash
  const sy = /scaleY\(([-0-9.]+)\)/.exec(fox().props.style.transform)
  if (sy) {
    const v = Number(sy[1])
    if (v < 0.995) sawCompress = true
    if (v > 1.005) sawStretch = true
  }
}
check('landing compresses her', peakSquash > 0.05, `peak squash=${peakSquash.toFixed(3)}`)
check('the compression reaches the rendered transform', sawCompress, `scaleY<1 seen: ${sawCompress}`)
check('the spring overshoots into a stretch', sawStretch, `scaleY>1 seen: ${sawStretch}`)
check('the pose scales about her feet', fox().props.style.transformOrigin === '50% 100%', String(fox().props.style.transformOrigin))

// --- gait is measured in pixels, not fractions of the frame -----------------
function measureGait() {
  el = render()
  fox().props.onContextMenu({ preventDefault() {} })
  el = render()
  let found = false
  const seen = new Set()
  for (let i = 0; i < 4000; i += 1) {
    tick(1)
    seen.add(state().mode)
    // The mode machine puts her to sleep after 45 s of no interaction, so keep
    // the idle clock topped up or the walk window closes mid-measurement.
    if (i % 400 === 399) {
      fox().props.onContextMenu({ preventDefault() {} })
      el = render()
    }
    if (state().mode === 'walk' && state().anim === 'walk' && state().vx === 0 && Math.abs(state().x - 0.5) < 0.25) {
      found = true
      break
    }
  }
  if (!found) {
    console.log('  gait probe: modes seen =', [...seen].join(','), '| anim =', state().anim, '| x =', state().x.toFixed(3))
    return NaN
  }
  fox().props.onContextMenu({ preventDefault() {} })
  el = render()
  const px0 = translateX()
  for (let i = 0; i < 60; i += 1) { tick(1); el = render() }
  if (state().mode !== 'walk') return NaN
  // Measured off the rendered transform, so it is real pixels regardless of
  // what stage width the harness currently claims.
  return Math.abs(translateX() - px0) / (60 * 16 / 1000)
}
const gaitAt1600 = measureGait()
stage.width = 2285
const gaitAt2285 = measureGait()
stage.width = 1600
check('gait is a real pixel speed at 1600 px', gaitAt1600 > 90 && gaitAt1600 < 150, `${Number(gaitAt1600).toFixed(0)} px/s (target 118)`)
check('gait holds when the frame grows', Math.abs(gaitAt2285 - gaitAt1600) < 12, `${Number(gaitAt2285).toFixed(0)} vs ${Number(gaitAt1600).toFixed(0)} px/s`)


// --- narrow overlays must not clip her --------------------------------------
// The horizontal limits were fixed fractions (0.07/0.93). At 390 px wide that put
// her edge about 33 px off-screen, and both walking and flinging clamped there.
const WIDE_W = stage.width
const WIDE_H = stage.height
stage.width = 390
stage.height = 900
ensureAwake()
el = render()
pointerDown(200, 300, { pointerId: 91 })
for (let i = 0; i < 6; i += 1) { clock += 16; pointerMove(200 - (i + 1) * 40, 300, { pointerId: 91 }) }
pointerUp(0, 300, { pointerId: 91 })
el = render()
let minEdge = Infinity
for (let i = 0; i < 400; i += 1) {
  tick(1)
  const leftEdge = state().x * stage.width - 60
  if (leftEdge < minEdge) minEdge = leftEdge
}
check('a narrow overlay never clips her left edge', minEdge >= -0.5, `leftmost edge at ${minEdge.toFixed(1)} px on a 390 px stage`)

// --- shrinking the overlay must not strand a perched fox ---------------------
stage.width = 1600
stage.height = 900
ensureAwake()
el = render()
pointerDown(800, 800, { pointerId: 92 })
clock += 16
pointerMove(800, 200, { pointerId: 92 })
el = render()
const preLift = state().bottom
pointerUp(800, 200, { pointerId: 92 })
el = render()
tick(20)
el = render()
pointerDown(800, 200, { pointerId: 93 })
el = render()
pointerUp(800, 200, { pointerId: 93 })
el = render()
const perchedHigh = state().ground
check('perched high before the shrink', perchedHigh > 500, `ground=${perchedHigh}`)

stage.height = 300 // the window is now shorter than her perch
doc.view._ro.cb()
el = render()
const cap = 300 - 130 - 4
check('a shrinking overlay brings her inside the new ceiling', state().bottom <= cap + 1e-6 && state().ground <= cap + 1e-6, `bottom=${state().bottom.toFixed(1)} ground=${state().ground.toFixed(1)} cap=${cap}`)

// --- picking her up cancels an in-flight hop --------------------------------
stage.width = WIDE_W
stage.height = WIDE_H
doc.view._ro.cb()
ensureAwake()
el = render()
wheel(-120)
el = render()
check('the leap set a hop in flight', state().hopV > 0, `hopV=${state().hopV}`)
pointerDown(800, 300, { pointerId: 94 })
el = render()
check('picking her up cancels the hop', state().hop === 0 && state().hopV === 0, `hop=${state().hop} hopV=${state().hopV}`)
pointerUp(800, 300, { pointerId: 94 })
el = render()
tick(30)
el = render()

let failed = 0
for (const r of results) {
  if (!r.ok) failed += 1
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  [${r.detail}]`)
}
console.log(failed === 0 ? `\nALL ${results.length} INTERACTION CHECKS PASS` : `\n${failed}/${results.length} CHECKS FAILED`)
process.exit(failed === 0 ? 0 : 1)
