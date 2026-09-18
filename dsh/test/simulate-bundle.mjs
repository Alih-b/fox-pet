// Verify the shipped browser bundle.
//
// lib/client.js is generated from fox-pet.client.js by build-bundle.mjs, and it
// is the artifact DSH actually serves to the browser. This evaluates it through
// a module-loader shim and drives `apply` against a stub context, so a bundle
// that parses but does not load, or that registers nothing, fails here.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '..', 'lib', 'client.js')
const bundle = readFileSync(bundlePath, 'utf8')

const problems = []
function check(name, ok, detail) {
  if (!ok) problems.push(`${name} [${detail}]`)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  [${detail}]`)
}

// --- the loader shim DSH uses in the browser --------------------------------
let spec = null
const fakeWindow = {
  __ModuleLoader__: {
    load(loaded) { spec = loaded },
  },
}

try {
  new Function('window', bundle)(fakeWindow)
} catch (error) {
  problems.push(`bundle threw: ${String(error)}`)
}
check('the bundle calls the module loader', spec !== null, spec === null ? 'never called' : 'called')
if (spec === null) {
  console.log('\n' + problems.length + ' PROBLEM(S)')
  process.exit(1)
}

check('the bundle registers the package id', spec.id === 'dsh-fox-pet', String(spec.id))
check('the bundle exposes a factory', typeof spec.factory === 'function', typeof spec.factory)

// --- the factory, with the same require surface the browser provides --------
const React = {
  createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
  useState(init) { return [init, () => {}] },
  useEffect() {},
}
const requireShim = (id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require(${JSON.stringify(id)})`)
}

let plugin = null
try {
  plugin = spec.factory(requireShim)
} catch (error) {
  problems.push(`factory threw: ${String(error)}`)
}
check('the factory produces a plugin object', plugin !== null && typeof plugin === 'object', plugin === null ? 'null' : typeof plugin)
check('the plugin exports apply()', typeof plugin?.apply === 'function', typeof plugin?.apply)
check('the plugin declares its injections', JSON.stringify(plugin?.inject) === '["timer"]', JSON.stringify(plugin?.inject))

// --- apply() must actually register into the overlay slot -------------------
let registered = null
let injected = null
const slots = {
  inject(key, callback) { injected = key; callback(); return () => {} },
  register(options, component) { registered = { options, component }; return () => {} },
}
const ctx = {
  get(name) { return name === 'slots' ? slots : undefined },
  interval() { return () => {} },
}
try {
  plugin.apply(ctx)
} catch (error) {
  problems.push(`apply threw: ${String(error)}`)
}
check('apply injects into shell.overlay', injected === 'shell.overlay', String(injected))
check('apply registers the fox entry', registered !== null && registered.options.id === 'fox-pet-folio', registered === null ? 'nothing registered' : String(registered.options.id))
check('the entry renders to an element', registered !== null && typeof registered.component === 'function', registered === null ? 'n/a' : typeof registered.component)

// The dynamic half and the bundle must describe the same package.
const source = readFileSync(join(here, '..', 'fox-pet.client.js'), 'utf8')
const bundleBody = bundle.slice(bundle.indexOf('const plugin = (function () {'), bundle.lastIndexOf('})();'))
const normalise = (text) => text.replace(/^\s*\/\/.*$/gm, '').replace(/\s+/g, ' ').trim()
const sourceNormalised = normalise(source)
const shippedNormalised = normalise(bundleBody)
check('the bundle carries the current client source', shippedNormalised.includes(sourceNormalised.slice(0, 400)), `${sourceNormalised.length} vs ${shippedNormalised.length} chars`)

console.log(problems.length === 0 ? '\nBUNDLE VALID' : `\n${problems.length} PROBLEM(S)`)
process.exit(problems.length === 0 ? 0 : 1)
