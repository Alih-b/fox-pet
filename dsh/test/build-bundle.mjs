// Build lib/client.js from fox-pet.client.js.
//
// The browser half ships as a pre-built bundle in DSH's module-loader format
// (`window.__ModuleLoader__.load({ id, factory })`), which the host's client
// module system serves from `exports["./client"]`. Building it here keeps
// fox-pet.client.js the single source of truth: the suites test that file, and
// this script only wraps it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const sourcePath = join(root, 'fox-pet.client.js')
const outDir = join(root, 'lib')
const outPath = join(outDir, 'client.js')
const PACKAGE_ID = 'dsh-fox-pet'

const source = readFileSync(sourcePath, 'utf8')

if (!/\nreturn \{\n/.test(source)) {
  throw new Error('fox-pet.client.js does not end in a `return { ... }` plugin object')
}

const indent = (text, pad) => text.replace(/^(?!$)/gm, pad)
const bundle = `window.__ModuleLoader__.load({
	id: ${JSON.stringify(PACKAGE_ID)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const plugin = (function () {
${indent(source.trimEnd(), '\t\t\t')}
		})();
		exports.apply = plugin.apply;
		exports.inject = plugin.inject;
		return module.exports;
	}
});
`

mkdirSync(outDir, { recursive: true })
writeFileSync(outPath, bundle, 'utf8')
console.log(`wrote ${outPath} (${Buffer.byteLength(bundle)} bytes)`)
