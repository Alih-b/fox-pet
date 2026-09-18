// Regenerate the eye-state fixture and assert it still matches.
//
// The fixture is what `npm test` reads, so the suite needs no Python and no image
// library. This script is the measurement behind it: it runs the classifier over
// the atlas and compares. Run it after the artwork changes.
//
// Pillow is the only requirement, and it is a development one. When it is absent
// this reports SKIP and exits 0 rather than failing a checkout that has every
// right to run `npm test` without it.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { assetPath } from './find-assets.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(here, 'idle-eye-state.json')

let measured
try {
  measured = execFileSync('python3', [join(here, 'classify-idle-eyes.py')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (error) {
  const detail = String(error.stderr ?? error.message ?? error)
  if (/PIL|ModuleNotFoundError|No module named/.test(detail)) {
    console.log('SKIP  Pillow is not installed, so the atlas cannot be measured here')
    console.log('      npm test does not need it: it reads the committed fixture')
    process.exit(0)
  }
  console.error('classifier failed:\n' + detail)
  process.exit(1)
}

const fresh = JSON.parse(measured)
const committed = JSON.parse(readFileSync(fixturePath, 'utf8'))
const scratch = process.env.UPDATE_FIXTURE === '1'

// The classifier locates the atlas by walking up, exactly as the suites do.
void assetPath

if (scratch) {
  writeFileSync(fixturePath, JSON.stringify(fresh, null, 2) + '\n')
  console.log('UPDATED ' + fixturePath)
  process.exit(0)
}

const same = JSON.stringify(fresh) === JSON.stringify(committed)
console.log('measured from the atlas: ' + Object.values(fresh).map((v) => v.eyes[0]).join(''))
console.log('committed fixture     : ' + Object.values(committed).map((v) => v.eyes[0]).join(''))
if (!same) {
  console.error('\nMISMATCH: the atlas changed, so the fixture is stale.')
  console.error('Re-run with UPDATE_FIXTURE=1 once you have confirmed the change is intended.')
  process.exit(1)
}
console.log('\nEYE-STATE FIXTURE MATCHES THE ATLAS')
