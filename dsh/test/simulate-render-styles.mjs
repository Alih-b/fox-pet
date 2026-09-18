// Render-output validation for the Folio client.
// The engine tests drive state; this one inspects the CSS strings the component
// actually produces, because an invalid declaration is silently DROPPED by the
// browser and leaves a perfectly plausible-looking static sprite.
import { readFileSync } from 'node:fs'

// FOX_CLIENT lets the suites run against an extracted deployed artifact,
// so what is verified is the code the browser actually received.
const SRC_PATH = process.env.FOX_CLIENT ?? new URL('../fox-pet.client.js', import.meta.url)
const src = readFileSync(SRC_PATH, 'utf8')

const values = []
let cursor = 0
let intervalCb = null
let registered = null
let mounted = false

globalThis.React = {
  useState(init) {
    const i = cursor
    cursor += 1
    if (values.length <= i) values.push(init)
    return [values[i], (u) => { values[i] = typeof u === 'function' ? u(values[i]) : u }]
  },
  useEffect(fn) { if (!mounted) { fn(); mounted = true } },
  createElement(type, props, ...children) { return { type, props, children } },
}

const slots = {
  inject(key, cb) { cb(); return () => {} },
  register(options, component) { registered = { options, component }; return () => {} },
}
const ctx = { get: (n) => (n === 'slots' ? slots : undefined), interval(cb) { intervalCb = cb; return () => {} } }

new Function(src)().apply(ctx)

function render() { cursor = 0; return registered.component({}) }
function tick(n = 1) { for (let i = 0; i < n; i += 1) intervalCb() }

function walk(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  out.push(node)
  const kids = node.children ?? []
  for (const kid of kids) walk(kid, out)
  return out
}
function findTag(root, tag) { return walk(root).find((n) => n.type === tag) ?? null }

const problems = []
function check(name, ok, detail) {
  if (!ok) problems.push(`${name} [${detail}]`)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  [${detail}]`)
}

// --- the validator must reject the exact bug that shipped -------------------
const TRANSLATE = /^translate3d\(-?[0-9]+(\.[0-9]+)?px, ?-?[0-9]+(\.[0-9]+)?px, ?0\)$/
check('validator rejects the shipped bug string', !TRANSLATE.test('translate3d(-0px,-0px,0))'), 'translate3d(-0px,-0px,0))')

function balanced(text) {
  let depth = 0
  for (const ch of text) {
    if (ch === '(') depth += 1
    else if (ch === ')') { depth -= 1; if (depth < 0) return false }
  }
  return depth === 0
}

// --- inspect every style value the component produces ----------------------
function auditStyles(root, label) {
  for (const node of walk(root)) {
    const style = node.props?.style
    if (!style) continue
    for (const [key, value] of Object.entries(style)) {
      if (typeof value === 'string' && !balanced(value)) {
        problems.push(`${label}: style.${key} has unbalanced parens: ${value}`)
      }
    }
    if (typeof style.transform === 'string' && style.transform.startsWith('translate3d(') && !style.transform.startsWith('translate3d(0,')) {
      if (!TRANSLATE.test(style.transform)) problems.push(`${label}: malformed img transform: ${style.transform}`)
    }
  }
}

const seenTransforms = new Set()
const seenRows = new Set()

for (let round = 0; round < 900; round += 1) {
  const el = render()
  auditStyles(el, `round ${round}`)
  const img = findTag(el, 'img')
  if (img !== null && img.props.style) {
    seenTransforms.add(img.props.style.transform)
    const y = /translate3d\(-?[0-9.]+px, ?(-?[0-9.]+)px, ?0\)/.exec(img.props.style.transform)
    if (y) seenRows.add(y[1])
  }
  tick()
}

check('sprite window is offset by a valid transform', seenTransforms.size > 0, `distinct transforms: ${seenTransforms.size}`)
check('sprite window actually moves between cells', seenTransforms.size >= 4, `${seenTransforms.size} distinct offsets, e.g. ${[...seenTransforms].slice(0, 3).join(' | ')}`)
check('sprite window visits multiple animation rows', seenRows.size >= 2, `distinct y offsets: ${[...seenRows].join(', ')}`)
check('no malformed style values anywhere in the tree', problems.length === 0, problems.length === 0 ? 'clean' : problems.slice(0, 5).join(' ;; '))

const first = [...seenTransforms][0]
check('first offset is the idle/top-left cell', first === 'translate3d(0px,0px,0)', String(first))

console.log(problems.length === 0 ? '\nRENDER STYLES VALID' : `\n${problems.length} PROBLEM(S)`)
process.exit(problems.length === 0 ? 0 : 1)
