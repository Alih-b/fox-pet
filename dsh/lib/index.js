// Folio the fox — host half of the DSH plugin.
// Ported from https://github.com/Alih-b/fox-pet (MIT).
//
// Serves the sprite atlas over a local route. Plugin routes are matched before
// the shipped static fallback, so the browser can load this with a plain
// <img src>. The atlas is not copied into this package: `assets/` is canonical
// at the repository root and shared with the Quickshell plugin, so this walks up
// from its own file to find it and works wherever the repository is checked out.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROUTE = '/fox-pet/spritesheet.webp'
const ATLAS_NAME = 'spritesheet.webp'
const MAX_ATLAS_BYTES = 8388608

function findAtlas() {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = join(dir, 'assets', ATLAS_NAME)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`dsh-fox-pet: no assets/${ATLAS_NAME} in any directory above ${fileURLToPath(import.meta.url)}`)
    }
    dir = parent
  }
}

/**
 * Host plugin body: register the route that serves the atlas.
 *
 * @param ctx - host root context.
 */
function apply(ctx) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return

  const atlas = findAtlas()
  let inflight = null

  function load() {
    if (inflight === null) {
      inflight = readFile(atlas)
        .then((bytes) => {
          if (bytes.length > MAX_ATLAS_BYTES) throw new Error(`atlas is ${bytes.length} bytes`)
          return bytes
        })
        .catch((error) => {
          inflight = null
          throw error
        })
    }
    return inflight
  }

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      try {
        const bytes = await load()
        res.writeHead(200, {
          'content-type': 'image/webp',
          'content-length': String(bytes.length),
          'cache-control': 'public, max-age=86400',
        })
        res.end(bytes)
      } catch (error) {
        console.error('dsh-fox-pet: spritesheet unavailable:', String(error))
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`dsh-fox-pet spritesheet unavailable: ${String(error)}`)
      }
    },
  }), 'fox-pet: atlas route')
  console.log(`dsh-fox-pet: serving ${ROUTE} from ${atlas}`)
}

/** Hard dependency: the route cannot be registered before the server exists. */
const inject = ['webServer']

export { apply, inject }
