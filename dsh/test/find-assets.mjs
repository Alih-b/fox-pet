// The port does not vendor its own copy of the atlas. `assets/` is canonical at
// the repository root and shared with the Quickshell plugin, so these suites walk
// up from their own directory to find it. That makes one code path work in both
// layouts: `dsh/test/` inside the repository, and `test/` in a standalone
// checkout of just the DSH treatment.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const START = dirname(fileURLToPath(import.meta.url))

export function assetPath(name) {
  let dir = START
  for (;;) {
    const candidate = join(dir, 'assets', name)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir || parent === '') {
      throw new Error(`could not find assets/${name} in any directory above ${START}`)
    }
    dir = parent
  }
}
