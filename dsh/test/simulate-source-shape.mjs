// Structural checks on the two source halves.
//
// They are function *bodies* for the Cordis evaluator, not modules: they open
// with `const` at top level and end in `return {...}`. A normal parser or linter
// cannot read them, so this file stands in for the checks a module would get:
// it evaluates them, inspects the plugin objects they return, and asserts the
// properties the runtime depends on.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(process.env.FOX_CLIENT ?? join(here, '..', 'fox-pet.client.js'), 'utf8')
const hostSrc = readFileSync(join(here, '..', 'fox-pet.host.js'), 'utf8')

const problems = []
function check(name, ok, detail) {
  if (!ok) problems.push(`${name} [${detail}]`)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  [${detail}]`)
}

// --- both halves evaluate and expose the expected shape ---------------------
let client = null
let host = null
try { client = new Function(src)() } catch (error) { problems.push(`client threw: ${String(error)}`) }
try { host = new Function(hostSrc)() } catch (error) { problems.push(`host threw: ${String(error)}`) }

check('client half evaluates', client !== null, client === null ? 'threw' : 'ok')
check('host half evaluates', host !== null, host === null ? 'threw' : 'ok')
check('client exposes apply()', typeof client?.apply === 'function', typeof client?.apply)
check('host exposes apply()', typeof host?.apply === 'function', typeof host?.apply)
check('client declares its timer dependency', JSON.stringify(client?.inject) === '["timer"]', JSON.stringify(client?.inject))

// --- comment stripping ------------------------------------------------------
// Needed before scanning, because prose mentions requestAnimationFrame and
// window. A plain regex would also truncate SHEET_REMOTE, whose URL contains
// "//", so this walks the text tracking quotes.
function stripComments(text) {
  let out = ''
  let i = 0
  let quote = null
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (quote !== null) {
      out += ch
      if (ch === '\\') { out += next ?? ''; i += 2; continue }
      if (ch === quote) quote = null
      i += 1
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; out += ch; i += 1; continue }
    if (ch === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i += 1; continue }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    out += ch
    i += 1
  }
  return out
}

const code = stripComments(src)
check('comment stripping keeps the asset URL intact', code.includes('raw.githubusercontent.com/Alih-b/fox-pet'), 'SHEET_REMOTE survived')

// --- browser APIs are only reached through an owned node --------------------
// The plugin must not assume window/document exist; it walks in via the root
// node's own document. A lookbehind keeps `view.requestAnimationFrame` out.
const BARE = /(?<![.\w])(window|document|localStorage|navigator|fetch|setTimeout|setInterval|requestAnimationFrame|cancelAnimationFrame)\b/g
const bare = [...new Set([...code.matchAll(BARE)].map((m) => m[1]))]
check('client never touches a bare browser global', bare.length === 0, bare.length ? `bare: ${bare.join(', ')}` : 'all access is through an owned node')

// --- every animation the effects can select exists in the atlas table -------
const ROWS = new Function(
  src.slice(src.indexOf('const ROWS = {'), src.indexOf('\n}\n', src.indexOf('const ROWS = {')) + 2) + '\nreturn ROWS;',
)()
const assigned = new Set([
  ...[...code.matchAll(/(?:n\.anim|action) = '([a-zA-Z][a-zA-Z-]*)'/g)].map((m) => m[1]),
  ...[...code.matchAll(/wake\(n, '([a-zA-Z][a-zA-Z-]*)'/g)].map((m) => m[1]),
  ...[...code.matchAll(/n\.mode = '([a-zA-Z][a-zA-Z-]*)'/g)].map((m) => m[1]),
])
const missing = [...assigned].filter((name) => ROWS[name] === undefined)
check('every animation named in logic exists in the atlas table', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${assigned.size} names resolved`)

// `think` is authored atlas art with no behaviour behind it. Pinning the exact
// set means wiring it up is a deliberate edit here, not a silent pass.
const expectedUnused = ['think']
const unused = Object.keys(ROWS).filter((name) => !code.includes("'" + name + "'"))
check('the set of unreachable atlas rows is unchanged', JSON.stringify(unused) === JSON.stringify(expectedUnused), `unused: [${unused.join(', ')}], expected [${expectedUnused.join(', ')}]`)

// The clock must be carried into n *before* syncAnim runs, or the reset that
// makes an animation switch self-contained is silently discarded on the next two
// lines and the new animation reads the previous one's accumulator.
{
  const tickBody = code.slice(code.indexOf('function tick(s, dt)'))
  const carried = tickBody.indexOf('n.acc = s.acc + dt')
  const synced = tickBody.indexOf('syncAnim(n)')
  check('the clock is carried before syncAnim can reset it', carried >= 0 && synced >= 0 && carried < synced, `carried at ${carried}, syncAnim at ${synced}`)
}

console.log(problems.length === 0 ? '\nSOURCE SHAPE VALID' : `\n${problems.length} PROBLEM(S)`)
process.exit(problems.length === 0 ? 0 : 1)
