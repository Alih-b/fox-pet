# Folio — a fox pet for DeepSeek Harness

Folio, from [`Alih-b/fox-pet`](https://github.com/Alih-b/fox-pet), ported from
Omarchy/Quickshell to the DSH Web GUI as a dynamic Cordis client plugin.

## What is here

The atlas, `pet.json` and `frame-names.json` are **not vendored here**. They are
canonical at the repository root under `assets/`, shared with the Quickshell
plugin, and this port resolves them from there — the host half by path, the
suites by walking up (`test/find-assets.mjs`, and the same walk in
`test/classify-idle-eyes.py`). The port keeps no copy of the atlas.

| Path | What it is |
|---|---|
| `fox-pet.host.js` | Host half of the plugin — the sprite route and its `fs` read. |
| `fox-pet.client.js` | Client half of the plugin — the animation engine and interactions. |
| `test/find-assets.mjs` | Locates the repository's `assets/` from either layout. |
| `LICENSE` | MIT, matching the upstream `manifest.json` declaration. |
| `test/simulate-source-shape.mjs` | Evaluates both halves, checks the plugin shape and the no-bare-globals rule. |
| `test/simulate-engine.mjs` | Headless run of the real client body for ~1 h, asserting invariants. |
| `test/simulate-idle.mjs` | Samples ~32 min of idle and checks the blink and sit choreography. |
| `test/simulate-interactions.mjs` | Drives the real pointer/mouse handlers through a re-rendering React stub. |
| `test/simulate-render-styles.mjs` | Validates the CSS the component emits. |
| `test/classify-idle-eyes.py` | Measures eyes-open/closed per idle frame from the atlas. |
| `test/dump-idle.mjs` | Prints the drawn sequence with durations, for judging a loop by eye. |
| `test/verify-deployed.sh` | Runs every suite against the deployed Package, not the file. |

A Dynamic Cordis Package is a function body handed to the evaluator, so it has no
file of its own to resolve a relative path against and no access to the
environment. The host half therefore searches the registered DSH workspaces in
registry order for `assets/spritesheet.webp`, and reports where it landed:

```
fox-pet: atlas resolved to /home/zerobyte/pet/assets/spritesheet.webp
```

Register the repository as a workspace and the port finds its own atlas. If
nothing is found the route answers 500 with the reason, and the client falls back
to the upstream URL — so a firewalled install shows the fallback emoji rather than a
blank. `harness.handle('sheet-info')` reports the resolved path and byte length.

The two `fox-pet.*.js` files are the bodies of the running Cordis Package
(`petfox-1`); `cordis_inspect_self` returns the same text. They are plain
function bodies, not modules: the host one is the body of `code.host` and the
client one is the body of `code.client`. That is why `simulate-source-shape.mjs`
stands in for the parse and lint checks a module would normally get.

## Installing into DSH

The port ships as a DSH plugin bundle. Install the package into a profile, list
it in that profile's bundles, and restart the profile once:

```bash
dsh plugin --profile web add dsh-fox-pet@link:/path/to/this/checkout
```

Then add the package to `$DSH_HOME/profiles/web/package.json`:

```json
"dsh": {
  "profile": {
    "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-fox-pet"]
  }
}
```

Restart `dsh web`. The host half registers `/fox-pet/spritesheet.webp`; the
browser half registers the fox in the `shell.overlay` slot.

Two declarations make this work, and both are required:

- **`dsh.bundle.patch`** — DSH activates a third-party plugin as a *bundle*. The
  package ships `cordis.patch.yml`, and the profile names the package in
  `dsh.profile.bundles`. A row written by hand into the profile's own patch is
  not enough: it composes without error but the plugin never loads.
- **`dsh.client.platform`, plus `exports["./client"]`** — the browser half is
  discovered by the host's client module system from the Loader's entries and
  served under `/plugins`. Without them the host half works and the fox never
  appears.

`link:` installs a symlink rather than a copy, so the host half keeps reading the
repository's canonical `assets/` — there is no second copy of the atlas.

Check the install without restarting your own server by booting a throwaway
instance on another port:

```bash
dsh --profile web --port 3099 --no-open
curl -sI http://127.0.0.1:3099/fox-pet/spritesheet.webp          # 200, the atlas
curl -s  http://127.0.0.1:3099/plugins/??dsh-fox-pet/client.js   # the browser bundle
```

Both are served without the session cookie: plugin routes are matched before the
shipped static fallback, which is where browser authentication lives.

`lib/client.js` is generated. Edit `fox-pet.client.js` and run
`npm run build:client`; `npm test` fails if the two disagree.

## Checks

```bash
npm test                 # all five suites, no dependencies, no network
npm run test:eyes        # regenerate the eye-state fixture from the atlas and compare
npm run idle:dump        # print the drawn frame sequence with durations
npm run verify:deployed  # the same suites against the deployed Package
```

`npm test` runs: source shape, engine invariants (225000 ticks), idle/sit
choreography, emitted CSS, and 74 interaction assertions. It needs nothing but
Node.

`test:eyes` is the one script that wants Pillow, because measuring the atlas means
decoding a webp. It is deliberately outside `npm test`: the eye state `npm test`
reads is a committed fixture (`test/idle-eye-state.json`) generated from the atlas,
and `test:eyes` regenerates it and asserts it still matches. When Pillow is absent
it reports SKIP rather than failing a checkout that has every right to run the
suite. Run it after the artwork changes; `UPDATE_FIXTURE=1` rewrites it.

`simulate-engine.mjs` also diffs the in-source `ROWS` table against the upstream
`assets/pet.json` row by row, so a bad transcription of the atlas layout cannot
pass silently.

Any suite also accepts `FOX_CLIENT=<path>` to run against a specific artifact, which
is how `verify:deployed` points them at the extracted Package.

`verify:deployed` decompresses the session transcript, pulls the newest
`cordis_define` call back out of it, and runs every suite against exactly the
text the browser received. It has caught two real incidents: a mismatched
`fallV` reset, and a dropped `buildAnims()` call that left every animation
lookup undefined and crashed the fox in the browser. The workspace file and the deployed Package are
two separate copies, and drift between them is invisible until it misbehaves —
as the `n.mode !== 'sleep'` clause below showed.

`simulate-render-styles.mjs` exists because of a real defect. The sprite window
is positioned by an inline `transform`, and the first version built that string
with one `)` too many:

```js
transform: 'translate(' + (-col * CW) + 'px,' + (-row * CH) + 'px)' + ')'
// -> "translate(-230.4px,-249.6px))"  — invalid, so the browser DROPS the declaration
```

A dropped declaration is invisible: the engine still advanced its frames, the
`<img>` still loaded, and the parent still animated `left`, so the fox appeared
as one frozen frame sliding along the x axis, with no emotes on click. State
tests cannot catch that; only inspecting the emitted CSS can. The suite asserts
balanced parentheses in every style value and that the sprite window reaches
several distinct cells across several animation rows.


## How the port works

The upstream plugin is three QML files driven by a Quickshell `Service`.
DSH cannot host QML, so the QML service was reimplemented as a Cordis plugin:

- **Host half** registers an exact HTTP route, `/fox-pet/spritesheet.webp`, that
  reads the vendored atlas through the `fs` service, caches the bytes in memory,
  and serves them. It also exposes a `sheet-info` RPC for diagnostics.
- **Client half** registers into the `shell.overlay` slot (a frame-wide,
  click-through floating layer) and owns the behaviour: the animation clock, the
  walk/idle/sit/sleep mode machine, hop physics, fling momentum, and the mouse
  interactions. It reuses the upstream `pet.json` frame timings for every
  animation it keeps; only idle was re-choreographed, see below.

The sprite is drawn by scaling the whole atlas into a clipped 120x130 px window
and offsetting it with `translate3d(-col * cellW, -row * cellH, 0)`; the art is
authored facing left, so `scaleX(-1)` mirrors it for rightward motion.

## Interactions

| Input | Folio's response |
|---|---|
| Left-click | Poke — she waves, or wakes with a stretch if asleep, then stays put for 6–12 s |
| Left-click mid-fall | **Catch** her: that spot becomes solid and she perches there |
| Double-click | Toggle the sleep/loaf state |
| Middle-click | Toggle the sleep/loaf state (same gesture, no double-tap) |
| Scroll down | Put her to sleep |
| Scroll up | Wake her and make her leap |
| Click & drag | Carry her anywhere in the frame, up to the top edge |
| Let go | She is dropped: the floor resets to the frame's bottom |
| Fling | Release during a fast drag; she coasts, slows and stops |
| Fling hard | Above ~1.15 frame-widths/s the slide becomes a tumble |
| Hit a wall hard | She somersaults in place; the wall still absorbs the motion |
| Petting | Stroke back and forth across her fur to trigger a play jump |
| Right-click | Bring her home: centred, on the floor, pose neutral |
| Idle 45 s | She yawns and curls up to sleep on her own |

## Idle and sitting

Neither is a fixed loop. Both are a **rest broken by occasional beats**, chosen at
run time — a run plan per animation (`RUN_PLANS`):

```
hold (2400-5400 ms, randomised)
  -> beat (blink / soft blink / double blink / glance / perk / look / startle)
  -> hold
  -> ...
```

Every beat starts on its expression and returns to the neutral frame, so a blink
is always open → closed → open, and no two beats can ever abut. The previous beat
is excluded from the next draw, so the same beat does not repeat consecutively
and the cycle is not fixed.

This replaced the upstream sequence `[0,1,2,1,0,1,2,1,0,4,0,5,0,6]`. Two things
were wrong with it:

- **Frames 1 and 2 are both eyes-closed.** Measured off the atlas, they have 0
  and 1 warm iris pixels where every other frame in the row has 86-128. So the
  sequence played three consecutive closed frames — `1, 2, 1` — with no open
  frame between them, twice per 20 s cycle. That reads as a twitch rather than a
  blink.
- **Frame 3, the only open-eyed glance in the row, was never played at all.**
  Frames 4, 5 and 6 were single 120-160 ms flashes separated by 3.8-4.2 s holds,
  which reads as isolated twitches rather than an idle.

**Sitting had the same problem.** Upstream looped all three sit frames at
4.2 fps for the whole 3-7 s sit, cycling the same poses repeatedly. It now plays a 700 ms settle (`[0,1,2]`) once on entry and
then rests on frame 2, with a slow weight shift only if the sit runs past 4-8 s.
Measured over ~32 simulated minutes, the busiest sit now spends 20% of its time
off the rest frame (the settle) and uses at most 3 cells.

`simulate-idle.mjs` samples ~32 simulated minutes and asserts the result. It
takes the eye state from `classify-idle-eyes.py`, which measures the atlas, so
the test cannot pass by hard-coding which frame is which — and it carries a
control asserting that the upstream sequence *would* fail the same check. It
also asserts that the drawn row always belongs to the animation that is running,
which is how the `runAnim` regression below was caught.

### Pacing

Idle is the resting state; walk and sit are excursions from it. The mode machine
draws between them at the end of each mode, and the weighting decides whether she
reads as resting or as pacing:

| mode | share of draws | duration |
|---|---|---|
| walk | 16% | 1.6–3.6 s |
| sit | 28% | 4–9 s |
| idle | 56% | 5–11 s |

Both excursions return to an idle of 4–11 s. Draws and time are not the same
thing: idle wins the majority of draws *and* lasts longer, so it takes about
three quarters of the waking clock. An earlier weighting gave walking a 40% share
with 2.4–6 s runs, which read as restlessness; over a simulated hour the awake
mix is now idle 77%, sit 19%, walk 4%, and no single walk runs past 3.6 s.
`simulate-engine.mjs` asserts those bounds so the mix cannot quietly slide back.

A **left-click pauses her**: it plays the greeting and then holds an idle of
6–12 s where she stands. Without that she waved and then carried on with whatever
the mode machine had already chosen, so a click looked like it had been ignored —
she would walk off mid-acknowledgement.

### The animation-switch trap

The run programme is loaded per animation, so it has to be brought back in step
whenever `anim` changes. Doing that on the *transition edge inside `tick`* is not
enough: the wheel and pointer handlers change `anim` from outside `tick`, and the
edge never fires for them. The idle programme then kept driving the draw — she
sat on the idle row for seconds while `anim` said `walk` or `yawn`. It is now a
level check at the top and bottom of every tick (`syncAnim`), which is
self-correcting regardless of who changed `anim`.

## Ground

Her vertical position is a `ground` value in pixels above the frame's bottom
edge, not a hard-coded floor:

- **default** is the frame's bottom (`GROUND`);
- **carrying her** does not change it; her position is fixed while the pointer
  holds her;
- **catching her mid-fall** with a click raises a ledge at exactly that height,
  and she keeps walking, sitting and sleeping on it;
- **letting go of her again** drops the ledge: the floor goes back to the bottom.

Her reachable height is the frame's own top edge (`stageH - CH - 4`), measured
from the real overlay box. An earlier revision clamped lifting to a hard-coded
520 px, which on a 1165 px window put her centre at roughly mid-screen — she
could not be carried any higher than that.

## Falling, and how she lands

Her hop and her fall use different physics on purpose. A hop is the `GRAVITY`
arc used for jumping; a *fall* is a drift. Released in the air she accelerates
gently (`FALL_ACCEL` 420 px/s²) up to a low ceiling (`FALL_TERMINAL` 120 px/s),
so from 300 px up she takes about **2.6 s** to reach the ground — a free drop
would take about 0.5 s. While airborne:

- the airborne pose (`fall`, the alert row) takes priority over the mode machine,
  so a ground animation cannot appear mid-descent;
- the sway is a sine whose amplitude fades as she nears the ground, so the landing
  position matches the release position;
- the shadow scales to 50% and fades to 45% at the top of a 320 px fall and
  returns as she lands, which indicates that she is airborne;
- landing triggers an `alert` and a squash scaled to the impact,
  but only above `LAND_IMPACT`; a gentle placement triggers none of them.

## Pose

Impulses are absorbed by a **damped spring** rather than being set and cleared:
`SQUASH_STIFF` 260 with `SQUASH_DAMP` 17, integrated in sub-steps of at most 8 ms
so a stalled frame (dt clamped to 100 ms) can never make it overshoot into a
wobble. A take-off stretches her first (`SQUASH_JUMP`); a landing compresses her
(scaleY < 1, scaleX > 1).

`transform-origin` is `50% 100%` — her feet. Scaling about the centre would lift
her off the ground on every impact.

A landing **releases the spring from rest** and caps the compression
(`SQUASH_LAND_SCALE` 0.6, and `impact / 2200` rather than `/ 1400`). Releasing
from rest is the smallest excursion a linear spring allows; a kick in either
direction only adds energy and deepens the stretch that follows (measured worst
stretch after a fall to the floor: 1.7% from rest, 2.7% with a +30 kick, 7.5%
with a -32 one). The bounce that used to be visible came from the landing hop
(`LAND_BOUNCE`, since removed), not from the spring.

## Gaze — not implemented, and why

Her eyes do **not** follow the pointer. Four attempts were made and each was
visibly wrong, so it was removed rather than shipped. The reason is the artwork:
she is one flat 120x130 sprite with no eye layer, the eye opening is only about
15.6 x 11.9 px, and its bottom edge sits roughly **two pixels** above the cream
muzzle. The idle row's open-eye frames are near-identical, so there is no
pre-drawn gaze to switch to, and the directional frames live in the alert row,
which is a different body pose.

Moving the eye on a flat sprite means clipping it, and the clip boundary is where
each attempt failed: a hand-drawn pupil either hides inside the painted one or
covers the iris; a clip smaller than the eye tears it; a clip containing the eye
drags the muzzle (254/255 worst change in that region); feathering the clip to
hide the seam blends the shifted eye with the original and reads as two
overlapping eyes. A hard boundary shows a seam and a soft one shows a double
image, so with two pixels of clearance there is no third option.

Making it work needs artwork rather than code: the iris and pupil as their own
atlas cells, or a drawn gaze set in the idle body, so that looking becomes a
frame choice instead of a pixel shift.

## Rendering

Three things keep the sprite smooth rather than laggy or ghosted.

1. **Frame-aligned clock.** The loop is `requestAnimationFrame` (reached through
   the root node's own document, so no browser global is assumed), with `dt`
   measured per frame and clamped to 1–100 ms. A 16 ms `ctx.interval` remains as
   the fallback when rAF is unavailable.
2. **No layout in the animation path.** Position is a `translate3d`, never a
   `left` percentage — animating `left` re-runs layout on every frame. The stage
   width is measured once on attach and on resize, never per frame.
3. **Integer sprite geometry.** `SCALE` is 0.625, so a cell is exactly 120×130 px
   and the sheet exactly 960×1430. Every sprite offset is therefore a whole
   number of pixels, and consecutive frames never resample into one another.
4. **Gait in pixels, not fractions.** `WALK_PX_PER_SEC` is 118, divided by the
   measured stage width, so her stride is the same whether the window is 1600 px
   or 2285 px wide. Measuring it in frame-widths made her scurry on a wide
   window and plod on a narrow one.

## Help text

The hover title is the only affordance, so it lists every gesture in
reading order, in the same voice:

> Folio the fox — click to poke her · double-click or middle-click to tuck her
> in · scroll down for sleep, up for a leap · drag her anywhere and let go to
> drop her · catch her mid-fall with a click to perch her there · stroke her fur
> to play · right-click to bring her home

Momentum is physical rather than greasy: speed decays exponentially
(`exp(-5.5 * dt)`), and a wall absorbs the slide instead of reflecting it, so a
flick travels a short distance and stops rather than crossing the frame and
bouncing off the edges. A sleeping fox is inert — picked up and put back down,
she stays asleep and does not slide.

`pointerdown` deliberately does **not** call `preventDefault`. Cancelling it
suppresses the browser's compatibility mouse events, which stops `dblclick` from
ever firing — that is why the sleep toggle used to do nothing.

## Known issues

Found while reviewing this port. None are defects in behaviour; they are the
things a reviewer should know rather than discover.

| # | Issue | Notes |
|---|---|---|
| 1 | `think` (row 7) is never selected | Authored atlas art with no behaviour behind it. `test/simulate-source-shape.mjs` pins the exact set of unreachable rows, so wiring it up is a deliberate edit there rather than a silent pass. |
| 2 | The host registers a `sheet-info` RPC nothing calls | Kept as a diagnostic hook; it reports the atlas byte length. Remove it if you would rather carry no dead surface. |
| 3 | The sprite route is not behind DSH's browser auth | `webServer.register` routes are matched *before* the shipped static fallback, and that fallback is where `authorizeIndex` lives. `/fox-pet/spritesheet.webp` is therefore readable without the session cookie. Impact is low — loopback only, and the asset is already public — but it is a property of the plugin-route contract, not an accident of this code. |
| 4 | The atlas is cached for the plugin's lifetime | Editing the repository's `assets/spritesheet.webp` needs a stop/start of the plugin; there is no invalidation. |
| 5 | No ARIA labelling | The sprite is decorative with `alt=""`, and the hover `title` carries every gesture. A screen reader gets nothing. `role="img"` plus an `aria-label` would fix it if the pet is considered meaningful content. |
| 6 | Scrolling is suppressed over the fox | The non-passive wheel listener calls `preventDefault`, so the page will not scroll with the cursor over her 120x130 px. That is the cost of scroll-to-sleep; drop the listener to hand scrolling back. |
| 7 | The two halves are function bodies, not modules | They cannot be imported or linted normally, which is why the structural suite exists. A thin loader that wraps them for local development would be a welcome follow-up. |

## Lifetime

This is a **dynamic Cordis plugin**: it lives in the running DSH process only,
so it disappears when the web server restarts. The Client package needs a
one-time approval in the UI on first run.

To make it permanent it has to become a file-backed plugin mounted from the host
composition, with a built client bundle. The assets here are already in the
right place for that.
