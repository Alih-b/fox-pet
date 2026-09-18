// Folio the fox — Host half of the DSH pet.
// Ported from https://github.com/Alih-b/fox-pet (MIT).
//
// Serves the sprite atlas over a local route. The port does not vendor its own
// copy: `assets/` is canonical at the repository root and shared with the QML
// plugin, so this resolves the file rather than baking in one machine's path.
// Plugin routes are matched before the shipped static fallback, so the browser
// can load this with a plain <img src>.
//
// A Dynamic Cordis Package is a function body handed to the evaluator, so it has
// no file of its own to resolve a relative path against and no access to the
// environment. The repository is normally a registered DSH workspace, so those
// are searched in registry order. When nothing is found the route answers 500 and
// the client falls back to the upstream URL, which is why a clear error matters
// more than a silent one.

return {
  apply(ctx) {
    const fs = ctx.get('fs')
    const webServer = ctx.get('webServer')
    if (fs === undefined || webServer === undefined) return

    const ATLAS_RELATIVE = 'assets/spritesheet.webp'
    const MAX_ATLAS_BYTES = 8388608
    let assetPath = null
    let sheet = null
    let inflight = null

    async function isReadableFile(path) {
      try {
        const target = await fs.resolve(path)
        const info = await fs.stat(target)
        return info !== undefined && info.type === 'file'
      } catch (error) {
        return false
      }
    }

    async function findAtlas() {
      if (assetPath !== null) return assetPath
      const candidates = []
      const registry = ctx.get('workspaceRegistry')
      if (registry !== undefined) {
        try {
          const workspaces = registry.list()
          for (let i = 0; i < workspaces.length; i += 1) {
            const root = workspaces[i].path
            if (typeof root === 'string' && root.length > 0) {
              candidates.push(root.replace(/\/+$/, '') + '/' + ATLAS_RELATIVE)
            }
          }
        } catch (error) {
          console.error('fox-pet: workspace registry unavailable:', String(error))
        }
      }
      for (let i = 0; i < candidates.length; i += 1) {
        if (await isReadableFile(candidates[i])) {
          assetPath = candidates[i]
          console.log('fox-pet: atlas resolved to ' + assetPath)
          return assetPath
        }
      }
      throw new Error(
        'no ' + ATLAS_RELATIVE + ' in any of ' + candidates.length +
        ' registered workspaces; register the repository as a workspace or serve the atlas yourself',
      )
    }

    function loadSheet() {
      if (sheet !== null) return Promise.resolve(sheet)
      if (inflight === null) {
        inflight = findAtlas()
          .then(function (path) { return fs.resolve(path) })
          .then(function (target) { return fs.readBytes(target, undefined, MAX_ATLAS_BYTES) })
          .then(function (bytes) {
            sheet = bytes
            return bytes
          })
          .catch(function (error) {
            inflight = null
            throw error
          })
      }
      return inflight
    }

    ctx.effect(function () {
      return webServer.register({
        kind: 'exact',
        path: '/fox-pet/spritesheet.webp',
        handler: async function (req, res) {
          try {
            const bytes = await loadSheet()
            res.writeHead(200, {
              'content-type': 'image/webp',
              'content-length': String(bytes.length),
              'cache-control': 'public, max-age=86400',
            })
            res.end(bytes)
          } catch (error) {
            console.error('fox-pet: spritesheet unavailable:', String(error))
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('fox-pet spritesheet unavailable: ' + String(error))
          }
        },
      })
    })

    // Diagnostic hook: reports where the atlas resolved and how big it is.
    // Nothing in the client calls this; it is here for a human debugging a 500.
    harness.handle('sheet-info', async function () {
      try {
        const bytes = await loadSheet()
        return { ok: true, path: assetPath, bytes: bytes.length }
      } catch (error) {
        return { ok: false, error: String(error) }
      }
    })
  },
}
