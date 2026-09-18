<div align="center">
  <img width="800" height="604" alt="Folio the fox" src="https://github.com/user-attachments/assets/ca0bd050-72f6-4384-b217-44354abc265c" />

  # Fox Pet

  **Fox Pet** (`fox-pet`) adds Folio, a desktop companion fox, to your Omarchy
  workspace. She wanders along the bottom of your screens, rests when you are
  inactive, wakes with smooth stretch transitions, and responds to mouse
  interactions and physics.

  [![MIT](https://img.shields.io/badge/licence-MIT-blue?style=flat-square)](LICENSE)
  ![Omarchy](https://img.shields.io/badge/Omarchy-Quickshell-1f6feb?style=flat-square)
  ![DSH](https://img.shields.io/badge/DSH-Cordis%20plugin-111?style=flat-square)
</div>

---

The plugin runs in two shells from one set of assets.

| | Omarchy | DeepSeek Harness |
|---|---|---|
| Runtime | Quickshell | Dynamic Cordis plugin |
| Source | `Service.qml`, `Panel.qml`, `BarWidget.qml` | [`dsh/`](dsh/) |
| Install | see below | [dsh/README.md](dsh/README.md) |

Both read `assets/spritesheet.webp` and `assets/pet.json`. The DSH port ships no
copy of the artwork.

## Installation

Install via the Omarchy plugin manager:

```bash
omarchy plugin add https://github.com/Alih-b/fox-pet --enable
```

For local development, run this from your checkout after making changes:

```bash
./install.sh
```

This installs your current working files, including uncommitted edits, reloads
the plugin, enables it, and shows the fox. It verifies that the shell loaded
the installed code and prints the location of the previous plugin backup.
You do not need to remove the plugin or commit changes first.
`omarchy plugin add "$PWD"` clones committed Git history and does not include
uncommitted edits.

To update a regular Git installation to the latest published release:

```bash
omarchy plugin update fox-pet
```

## Controls

You can summon or dismiss Folio using the **Fox Pet** status bar widget, or interact directly with her using the mouse:

| Input | Folio's Response |
|---|---|
| **Left-click** | Pokes Folio — she waves one paw, or wakes gently from sleep; further pokes during wake-up let the rise finish |
| **Double-click** | Toggles sleep state — she curls into a loaf or stretches awake |
| **Scroll down** | Puts her to sleep |
| **Scroll up** | Prompts her to leap |
| **Click & drag** | Moves her across screens (she stays asleep if moved while resting) |
| **Fling** | Releasing during a fast drag tosses her horizontally with momentum |
| **Petting** | Stroking the cursor back and forth across her fur triggers a playful jump |
| **Right-click** | Centers her on the active display |

## Commands

Control Folio from scripts or your terminal via `omarchy-shell`:

<div align="center">
  <img width="800" height="604" alt="folio-jump" src="https://github.com/user-attachments/assets/76b877af-9641-4d07-8a92-815c29c4a65a" />
</div>

```bash
omarchy-shell fox-pet toggle       # summon or hide Folio
omarchy-shell fox-pet sleepToggle  # toggle sleep / wake
omarchy-shell fox-pet jump         # make Folio leap
omarchy-shell fox-pet reset        # center Folio on the active display
omarchy-shell fox-pet state        # query state (on/off, state, direction, frame)
```

## Frame atlas

Every sprite frame in `assets/spritesheet.webp` has a unique name in `assets/frame-names.json` — use these names (e.g. `sleep-deep-curl`, `turn-quarter-right`) when discussing animation or rendering issues.

A private viewer with every named frame, row metadata, and live cadence previews can be regenerated locally (output is gitignored):

```bash
python3 tools/build-frame-atlas.py
xdg-open scratch/frame-atlas.html
```

Walking verification (requires Quickshell and Qt Quick Test):

```bash
python3 -m unittest discover -s tests
QT_QPA_PLATFORM=offscreen QT_QPA_PLATFORMTHEME= QT_QUICK_BACKEND=software /usr/lib/qt6/bin/qmltestrunner -input tests/tst_walk_render.qml
```

These check distance and stride continuity across refresh rates, starts and
wall reversals, a real timer-driven walk, and rendered pixels against the
six authored walking crops in both directions.

## Animation tuning

Summon Folio first, then use the development commands to repeat an action:

```bash
omarchy-shell fox-pet preview walk -1   # walk left from the center of the current screen
omarchy-shell fox-pet preview greet 1   # play one greeting, then hold idle
omarchy-shell fox-pet debugState        # requested action, actual pose, motion, reload status
omarchy-shell fox-pet reloadAnimationMeta
omarchy-shell fox-pet resume            # return to normal autonomous behavior
```

`preview` requires a direction of `1` or `-1` and accepts `idle`, `walk`,
`sitRight`, `sitLeft`, `greet`, `sleep`, `play`, `alert`, `yawn`, `think`,
`spin`, `somersault`, and `jump`. Each call clears temporary motion and starts
grounded at the center of the current monitor. Authored facing restrictions
still apply; for example, greeting faces forward regardless of direction.
Idle, walk, sitting, and sleep hold until another command. Other clips play
once and return to idle; jumping finishes after landing. Walk and jump require
the **Wander around** setting. Release any drag before previewing or resuming.

Use the frame atlas to choose poses, edit `sequence` and `durations` in
`assets/pet.json`, run `reloadAnimationMeta`, and check `debugState` until
`metadataStatus` is `ok`. Then repeat the preview command to review the change
with the actual renderer and new clip duration. Reload is asynchronous; invalid
or unreadable metadata leaves the working copy intact and reports an error in
`metadataStatus`. No shell restart is needed for metadata changes.

Preview mode pauses random behavior without changing settings. Mouse actions
still work, so keep the pointer away when comparing repeated previews. Preview
state is transient, position saves are suppressed while previewing, and hiding
the fox clears preview mode. `resume` resets to grounded idle and restarts the
normal action timer. The tests above also cover preview controls and metadata
reload using a private copy of the assets.

## DeepSeek Harness

DSH cannot load QML, so the same behaviour is reimplemented as a Dynamic Cordis
plugin. It has two halves: a host half that serves `assets/spritesheet.webp` over
a local route, and a client half that runs the animation, physics and input
handling in the web UI. It uses the same `pet.json` timings, except for idle and
sitting, which are re-choreographed — see [`dsh/README.md`](dsh/README.md).

The gestures differ from the desktop build:

| Input | Response |
|---|---|
| **Left-click** | Poke — she waves, or wakes with a stretch |
| **Left-click mid-fall** | Catches her; that height becomes the surface she stands on |
| **Double-click** or **middle-click** | Toggle the sleep state |
| **Scroll down** / **scroll up** | Sleep / leap |
| **Click & drag** | Move her; releasing drops her and she falls at a capped speed |
| **Fling** | A fast release slides her to a stop; a fast enough one spins her |
| **Hit a wall hard** | She somersaults in place; the wall does not bounce her |
| **Stroking the cursor across her** | Playful jump |
| **Right-click** | Recentres her on the floor |

The port is verified by five suites that need only Node:

```bash
cd dsh
npm test
```

They cover the plugin's shape, engine invariants over 225000 ticks, the idle and
sitting choreography, the CSS the component emits, and 60 interaction,
physics and layout assertions.

## Assets

`assets/` is the only copy of the artwork: the 1536×2288 atlas, the frame-name
map, and `pet.json`, the animation spec. Both shells read from it, so a new frame
is added once.

## Licence

MIT. See [LICENSE](LICENSE).
