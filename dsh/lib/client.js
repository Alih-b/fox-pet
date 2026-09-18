window.__ModuleLoader__.load({
	id: "dsh-fox-pet",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const plugin = (function () {
			// Folio the fox — Client half of the DSH pet.
			// Ported from https://github.com/Alih-b/fox-pet (MIT).
			//
			// Registers into the `shell.overlay` slot (a frame-wide, click-through layer) and
			// owns the behaviour the upstream Quickshell Service provided: the animation
			// clock, the idle/walk/sit/sleep mode machine, hop physics, fling momentum and
			// the mouse interactions. Frame timings are the upstream assets/pet.json values.
			//
			// Rendering notes:
			//  * the fox is positioned with `translate3d`, never `left`, so a moving pet
			//    never triggers layout — only compositing;
			//  * SCALE is chosen so a cell is exactly 120x130 px, so every sprite offset is
			//    an integer and nothing resamples between frames;
			//  * the clock is requestAnimationFrame where available, so updates land on
			//    frame boundaries instead of drifting against a 16 ms timer;
			//  * pose (squash/stretch) is a damped spring, applied about her feet;
			//  * gait speed is in pixels per second, so her stride is the same on any
			//    window size instead of stretching with the frame.

			const SHEET_LOCAL = '/fox-pet/spritesheet.webp'
			const SHEET_REMOTE = 'https://raw.githubusercontent.com/Alih-b/fox-pet/main/assets/spritesheet.webp'

			// 192 * 0.625 = 120 and 208 * 0.625 = 130: integer cells, integer sheet (960x1430).
			const SCALE = 0.625
			const CELL_W = 192
			const CELL_H = 208
			const COLS = 8
			const ROW_TOTAL = 11
			const CW = CELL_W * SCALE
			const CH = CELL_H * SCALE
			const SHEET_W = CW * COLS
			const SHEET_H = CH * ROW_TOTAL

			const TICK = 16
			const GROUND = 6 // the default floor, in px above the frame's bottom edge
			const DRAG_TOP_PAD = 4 // how close her ears may come to the frame's top edge
			const WALK_PX_PER_SEC = 118
			const GRAVITY = 2600
			const JUMP_V = 520
			const SLEEP_AFTER = 45000

			// Her own gravity is nothing like the hop's. Released in the air she opens out
			// and drifts: a gentle ramp and a low ceiling, so it reads as a slow fall
			// rather than a drop.
			const FALL_ACCEL = 420
			const FALL_TERMINAL = 120
			const FALL_SWAY_PX = 16
			const FALL_SWAY_PERIOD = 900 // ms for one full left-right-left swing
			const LAND_IMPACT = 45
			const LAND_BOUNCE = 240

			// Pose. An impulse from a landing or a take-off is absorbed by a damped spring,
			// so she compresses on impact and overshoots gently back to neutral.
			const SQUASH_STIFF = 260
			const SQUASH_DAMP = 17
			const SQUASH_LAND_MIN = 0.08
			const SQUASH_LAND_MAX = 0.26
			const SQUASH_JUMP = 0.14

			// Momentum. Exponential decay and walls that absorb, instead of the old model
			// that bled 7% of speed per 50 ms tick and reflected at 45%.
			const FLING_DAMPING = 5.5
			const FLING_STOP = 0.05
			const FLING_MAX = 1.8
			const FLING_TUMBLE = 1.15
			const WALL_THUD = 0.5
			const EDGE_PAD = 10 // px of clearance between her edge and the frame

			const ROWS = {
			  idle: { row: 0, frames: 7, fps: 5, sequence: [0, 1, 2, 1, 0, 1, 2, 1, 0, 4, 0, 5, 0, 6], durations: [3600, 90, 110, 90, 3600, 90, 110, 90, 4200, 140, 3800, 120, 4000, 160] },
			  walk: { row: 1, frames: 8, fps: 8, sequence: [1, 2, 3, 4, 5, 6] },
			  sit: { row: 2, frames: 3, fps: 4.166666666666667 },
			  greet: { row: 3, frames: 4, fps: 10, sequence: [0, 1, 2, 1, 3], durations: [120, 80, 190, 110, 160], once: true },
			  yawn: { row: 4, frames: 5, fps: 4, sequence: [0, 1, 2, 3, 4], durations: [200, 220, 520, 240, 280], once: true },
			  sleep: { row: 5, frames: 8, fps: 5, sequence: [3, 4, 6, 7, 3, 4, 6, 7, 5], durations: [900, 800, 1100, 1300, 900, 800, 1100, 1300, 220] },
			  play: { row: 6, frames: 6, fps: 8, sequence: [0, 1, 2, 3, 4, 5], durations: [100, 120, 130, 250, 200, 150], once: true },
			  think: { row: 7, frames: 6, fps: 5, sequence: [0, 1, 2, 3, 4, 5], durations: [180, 220, 250, 450, 280, 320] },
			  alert: { row: 8, frames: 6, fps: 6, sequence: [0, 1, 2, 3, 4, 5], durations: [120, 140, 160, 70, 180, 380], once: true },
			  fall: { row: 8, frames: 6, fps: 6, sequence: [0, 1, 2, 3, 4, 5], durations: [120, 140, 160, 70, 180, 380] },
			  spin: { row: 9, frames: 8, fps: 5.555555555555556, sequence: [2, 3, 4, 5, 6, 7, 0, 1, 2], durations: [180, 180, 180, 180, 180, 180, 180, 180, 180], once: true },
			  somersault: { row: 10, frames: 8, fps: 8, once: true },
			}

			const ANIM = {}
			function buildAnims() {
			  for (const name in ROWS) {
			    const spec = ROWS[name]
			    let seq = spec.sequence
			    if (seq === undefined) {
			      seq = []
			      for (let i = 0; i < spec.frames; i += 1) seq.push(i)
			    }
			    let durs = spec.durations
			    if (durs === undefined) {
			      durs = []
			      const step = 1000 / spec.fps
			      for (let i = 0; i < seq.length; i += 1) durs.push(step)
			    }
			    ANIM[name] = { row: spec.row, seq: seq, durs: durs, once: spec.once === true }
			  }
			}
			buildAnims()

			// Run plans. A looping row is not always a loop: these rows are staged as a
			// neutral rest broken by occasional beats, chosen at run time, so a twitch never
			// lands twice in a row and nothing shuffles the same two poses forever.
			//
			// idle — the upstream sequence played frames 1, 2, 1 back to back. Measured off
			// the atlas, frames 1 and 2 are BOTH eyes-closed (0 and 1 iris pixels; every
			// other frame in the row has 86-128), so that was three consecutive closed
			// frames with no open frame between them, twice per 20 s cycle: a head twitch,
			// not a blink. It also left frame 3, the only open-eyed glance, unused.
			//
			// sit — upstream looped all three sit frames at 4.2 fps, which ran unchanged for
			// the whole 3-7 s sit and read as her twitching between two crouches. She now
			// settles once and then rests, with a slow weight shift only if the sit lasts
			// long enough to want one.
			//
			// Every beat starts on its expression and returns to the rest frame, so no two
			// beats can abut and a blink is always open -> closed -> open.
			const RUN_PLANS = {
			  idle: {
			    row: 0,
			    rest: 0,
			    holdMin: 1200,
			    holdSpan: 2400,
			    settle: null,
			    beats: [
			      { id: 'blink', weight: 34, seq: [1, 0], durs: [110, 120] },
			      { id: 'blink-soft', weight: 16, seq: [2, 0], durs: [120, 130] },
			      { id: 'double-blink', weight: 14, seq: [1, 0, 2, 0], durs: [90, 80, 110, 120] },
			      { id: 'glance', weight: 12, seq: [3, 0], durs: [430, 170] },
			      { id: 'perk', weight: 10, seq: [4, 0], durs: [260, 150] },
			      { id: 'look', weight: 8, seq: [5, 0], durs: [300, 150] },
			      { id: 'startle', weight: 6, seq: [6, 0], durs: [320, 170] },
			    ],
			  },
			  sit: {
			    row: 2,
			    rest: 2,
			    holdMin: 4200,
			    holdSpan: 4200,
			    settle: { seq: [0, 1, 2], durs: [200, 220, 280] },
			    beats: [
			      { id: 'shift', weight: 1, seq: [1, 2], durs: [900, 1000] },
			    ],
			  },
			}

			function clamp(v, lo, hi) {
			  if (v < lo) return lo
			  if (v > hi) return hi
			  return v
			}

			function nowMs() {
			  try {
			    return Date.now()
			  } catch (error) {
			    return 0
			  }
			}

			return {
			  inject: ['timer'],
			  apply(ctx) {
			    const slots = ctx.get('slots')
			    if (slots === undefined) return

			    let rngState = 20260919
			    function rnd() {
			      rngState = (rngState * 16807) % 2147483647
			      return rngState / 2147483647
			    }

			    let drag = null
			    let petX = 0
			    let petDir = 0
			    let strokes = 0
			    let rootNode = null
			    let foxNode = null
			    let measured = false
			    let stageW = 0
			    let stageH = 0

			    // The highest she can be lifted: her ears just clear the frame's top edge.
			    function ceiling() {
			      const h = stageH > 0 ? stageH : 900
			      return Math.max(GROUND, h - CH - DRAG_TOP_PAD)
			    }

			    // Horizontal limits derived from the sprite's real width. As fixed fractions
			    // (0.07/0.93) these stopped working on a narrow overlay: at 390 px the left
			    // limit put her edge about 33 px off-screen, and both walking and flinging
			    // clamped to it.
			    function edgeBounds() {
			      const w = stageW > 0 ? stageW : 1600
			      const inset = (CW / 2 + EDGE_PAD) / w
			      const lo = inset > 0.5 ? 0.5 : inset
			      return { lo: lo, hi: 1 - lo }
			    }

			    const initial = {
			      x: 0.5,
			      bottom: GROUND,
			      ground: GROUND, // the surface she stands on; a click mid-fall moves it
			      facing: -1,
			      vx: 0,
			      anim: 'idle',
			      frame: 0,
			      acc: 0,
			      cell: 0,
			      row: 0,
			      // Which run plan is loaded, and its run: which frames to play, for how
			      // long, and whether we are currently resting between beats.
			      animLoaded: 'idle',
			      runSeq: [0],
			      runDurs: [2600],
			      runHolding: true,
			      runLast: null,
			      hop: 0,
			      hopV: 0,
			      fallV: 0,
			      swayPhase: 0,
			      squash: 0,
			      squashV: 0,
			      mode: 'idle',
			      modeMs: 0,
			      modeDur: 3200,
			      idleMs: 0,
			      action: null,
			      drag: false,
			      src: SHEET_LOCAL,
			      imgStatus: 'loading',
			    }

			    function settle(n) {
			      if (n.action !== null) return
			      // Only touch the clock when the animation actually changes. Restarting an
			      // idle run that is already running would rewind it forever.
			      if (n.anim === n.mode) return
			      n.anim = n.mode
			      n.frame = 0
			      n.acc = 0
			    }

			    // A wall never returns momentum. Arriving hard enough earns a somersault,
			    // which acknowledges the hit without the old ping-pong rebound.
			    function stopAtWall(n) {      const speed = n.vx > 0 ? n.vx : -n.vx
			      n.vx = 0
			      if (speed > WALL_THUD && n.mode !== 'sleep') {
			        n.action = 'somersault'
			        n.anim = 'somersault'
			        n.frame = 0
			        n.acc = 0
			        return
			      }
			      settle(n)
			    }

			    // Land with an impact: compress, and let the spring bring her back.
			    function touchdown(n, impact) {
			      n.squash = clamp(SQUASH_LAND_MIN + impact / 1400, SQUASH_LAND_MIN, SQUASH_LAND_MAX)
			      n.squashV = 0
			      n.hopV = LAND_BOUNCE
			      if (n.mode !== 'sleep' && n.action === null) {
			        n.action = 'alert'
			        n.anim = 'alert'
			        n.frame = 0
			        n.acc = 0
			      }
			    }

			    // Weighted pick that never repeats the previous beat, so she does not blink
			    // the same way twice running.
			    function pickRunBeat(n, plan) {
			      const beats = plan.beats
			      let total = 0
			      for (let i = 0; i < beats.length; i += 1) {
			        if (beats[i].id !== n.runLast) total += beats[i].weight
			      }
			      if (total <= 0) return beats[0]
			      let roll = rnd() * total
			      for (let i = 0; i < beats.length; i += 1) {
			        const beat = beats[i]
			        if (beat.id === n.runLast) continue
			        roll -= beat.weight
			        if (roll <= 0) return beat
			      }
			      return beats[0]
			    }

			    function holdMs(plan) {
			      return plan.holdMin + rnd() * plan.holdSpan
			    }

			    // Bring the loaded programme in step with the animation that is running.
			    // Called at the top of every tick and again after anything that can change
			    // anim, so a switch made from outside tick (the wheel or a pointer handler)
			    // is picked up too. Leaving the previous programme driving the draw kept her
			    // on the idle row for seconds while `anim` said walk or yawn, and a stale
			    // frame index could run past the new sequence and poison the accumulator.
			    function syncAnim(n) {
			      if (n.animLoaded === n.anim) return
			      const plan = RUN_PLANS[n.anim]
			      if (plan !== undefined) {
			        resetRun(n, plan)
			      } else {
			        const spec = ANIM[n.anim] || ANIM.idle
			        n.frame = 0
			        n.acc = 0
			        n.cell = spec.seq[0]
			        n.row = spec.row
			      }
			      n.animLoaded = n.anim
			    }

			    // Load a plan. A settle plays once on entry (sitting down); otherwise the run
			    // opens on the rest frame. The drawn cell is set here so the first frame of
			    // the new run can never be the outgoing animation's cell.
			    function resetRun(n, plan) {
			      if (plan.settle !== null) {
			        n.runSeq = plan.settle.seq
			        n.runDurs = plan.settle.durs
			        n.runHolding = false
			      } else {
			        n.runSeq = [plan.rest]
			        n.runDurs = [holdMs(plan)]
			        n.runHolding = true
			      }
			      n.frame = 0
			      n.acc = 0
			      n.cell = n.runSeq[0]
			      n.row = plan.row
			    }

			    // Alternate hold -> beat -> hold, so every expression is framed by stillness
			    // and always resolves back to the rest frame.
			    function advanceRun(n, plan) {
			      if (n.runHolding) {
			        const beat = pickRunBeat(n, plan)
			        n.runSeq = beat.seq
			        n.runDurs = beat.durs
			        n.runHolding = false
			        n.runLast = beat.id
			        return
			      }
			      n.runSeq = [plan.rest]
			      n.runDurs = [holdMs(plan)]
			      n.runHolding = true
			    }

			    function tick(s, dt) {
			      const n = Object.assign({}, s)
			      const dts = dt / 1000
			      n.idleMs = s.idleMs + dt
			      n.modeMs = s.modeMs + dt

			      // Carry the clock forward first so syncAnim's reset wins when the animation
			      // changed. Assigning these afterwards silently discarded that reset and left
			      // the new animation reading the previous one's accumulator.
			      n.acc = s.acc + dt
			      n.frame = s.frame
			      syncAnim(n)
			      const running = RUN_PLANS[n.anim]
			      let a = running !== undefined
			        ? { seq: s.runSeq, durs: s.runDurs, row: running.row, once: false }
			        : (ANIM[n.anim] || ANIM.idle)
			      let guard = 0
			      while (guard < 40) {
			        const dur = a.durs[n.frame]
			        if (n.acc < dur) break
			        n.acc -= dur
			        n.frame += 1
			        guard += 1
			        if (n.frame >= a.seq.length) {
			          if (a.once) {
			            n.action = null
			            n.anim = n.mode === 'sleep' ? 'sleep' : n.mode
			            n.frame = 0
			            n.acc = 0
			            break
			          }
			          if (running !== undefined) {
			            advanceRun(n, running)
			            a = { seq: n.runSeq, durs: n.runDurs, row: running.row, once: false }
			            n.frame = 0
			            continue
			          }
			          n.frame = 0
			        }
			      }
			      // The drawn atlas cell is resolved here, so the render never has to know
			      // which program is running.
			      n.cell = a.seq[n.frame] === undefined ? 0 : a.seq[n.frame]
			      n.row = a.row

			      // Sub-stepped so a stalled frame (dt clamped to 100 ms) can never make the
			      // spring overshoot into a wobble.
			      const steps = Math.min(12, Math.ceil(dt / 8))
			      const h = dt / steps / 1000
			      for (let i = 0; i < steps; i += 1) {
			        n.squashV = n.squashV + (-SQUASH_STIFF * n.squash - SQUASH_DAMP * n.squashV) * h
			        n.squash = n.squash + n.squashV * h
			      }
			      if (n.squash < 0.0004 && n.squash > -0.0004 && n.squashV < 0.01 && n.squashV > -0.01) {
			        n.squash = 0
			        n.squashV = 0
			      }

			      if (n.hop > 0 || n.hopV !== 0) {
			        n.hop = n.hop + n.hopV * dts
			        n.hopV = n.hopV - GRAVITY * dts
			        if (n.hop <= 0) {
			          const landing = n.hopV
			          n.hop = 0
			          n.hopV = 0
			          if (landing < -160) {
			            n.squash = clamp(SQUASH_LAND_MIN + -landing / 2600, SQUASH_LAND_MIN, SQUASH_LAND_MAX)
			            n.squashV = 0
			          }
			        }
			      }

			      // Release her in the air and she drifts down instead of dropping. While
			      // the pointer owns her position, gravity stays out of the way.
			      n.swayPhase = s.swayPhase + dt
			      if (!n.drag && (n.bottom > n.ground || n.fallV > 0)) {
			        n.fallV = Math.min(n.fallV + FALL_ACCEL * dts, FALL_TERMINAL)
			        n.bottom = n.bottom - n.fallV * dts
			        if (n.bottom <= n.ground) {
			          const impact = n.fallV
			          n.bottom = n.ground
			          n.fallV = 0
			          if (impact > LAND_IMPACT) touchdown(n, impact)
			        }
			      }

			      // A resting fox is inert: no residual momentum, no wandering.
			      if (n.mode === 'sleep') n.vx = 0

			      const eb = edgeBounds()

			      if (!n.drag && n.mode !== 'sleep') {
			        if (n.vx !== 0) {
			          // A released fling takes priority over the walk cycle, and friction is
			          // exponential and strong, so she coasts to a stop instead of gliding.
			          n.x = n.x + n.vx * dts
			          n.vx = n.vx * Math.exp(-FLING_DAMPING * dts)
			          if (n.vx < FLING_STOP && n.vx > -FLING_STOP) {
			            n.vx = 0
			            settle(n)
			          }
			          // Walls absorb the motion; she does not rebound off them.
			          if (n.x < eb.lo) {
			            n.x = eb.lo
			            stopAtWall(n)
			          } else if (n.x > eb.hi) {
			            n.x = eb.hi
			            stopAtWall(n)
			          }
			        } else if (n.anim === 'walk' && n.mode === 'walk') {
			          // Pixels per second, not fractions: her stride stays the same when the
			          // window is resized.
			          const perSec = stageW > 0 ? WALK_PX_PER_SEC / stageW : WALK_PX_PER_SEC / 1600
			          n.x = n.x + n.facing * perSec * dts
			          if (n.x < eb.lo) {
			            n.x = eb.lo
			            n.facing = 1
			          } else if (n.x > eb.hi) {
			            n.x = eb.hi
			            n.facing = -1
			          }
			        }
			      }

			      if (!n.drag) {
			        if (n.mode !== 'sleep' && n.idleMs > SLEEP_AFTER) {
			          n.mode = 'sleep'
			          n.modeMs = 0
			          n.modeDur = 1e9
			          n.action = 'yawn'
			          n.anim = 'yawn'
			          n.frame = 0
			          n.acc = 0
			        } else if (n.modeMs >= n.modeDur) {
			          n.modeMs = 0
			          const roll = rnd()
			          if (n.mode === 'walk') {
			            n.mode = 'idle'
			            n.modeDur = 1600 + rnd() * 2600
			          } else if (n.mode === 'sit') {
			            n.mode = 'idle'
			            n.modeDur = 1200 + rnd() * 2200
			          } else if (roll < 0.45) {
			            n.mode = 'walk'
			            n.modeDur = 2400 + rnd() * 3600
			            n.facing = rnd() < 0.5 ? -1 : 1
			          } else if (roll < 0.72) {
			            n.mode = 'sit'
			            n.modeDur = 3000 + rnd() * 4000
			          } else {
			            n.mode = 'idle'
			            n.modeDur = 1500 + rnd() * 2500
			          }
			          if (n.action === null && n.anim !== n.mode) {
			            n.anim = n.mode
			            n.frame = 0
			            n.acc = 0
			          }
			        }
			      }

			      // The airborne pose outranks whatever the mode machine just chose, so a
			      // drifting fox never flickers back to a ground animation mid-descent.
			      if (!n.drag && n.bottom > n.ground && n.mode !== 'sleep' && n.action === null && n.anim !== 'fall') {
			        n.anim = 'fall'
			        n.frame = 0
			        n.acc = 0
			      }

			      // Everything that can change anim has now run, so bring the loaded
			      // programme back in step before the frame is drawn.
			      syncAnim(n)

			      return n
			    }

			    function wake(n, action) {
			      n.idleMs = 0
			      if (n.mode === 'sleep') {
			        n.mode = 'idle'
			        n.modeMs = 0
			        n.modeDur = 1800 + rnd() * 2000
			        n.action = 'yawn'
			        n.anim = 'yawn'
			        n.frame = 0
			        n.acc = 0
			        return
			      }
			      if (action !== null && n.action === null) {
			        n.action = action
			        n.anim = action
			        n.frame = 0
			        n.acc = 0
			      }
			    }

			    function sleep(n) {
			      n.idleMs = 0
			      n.vx = 0
			      n.mode = 'sleep'
			      n.modeMs = 0
			      n.modeDur = 1e9
			      n.action = 'yawn'
			      n.anim = 'yawn'
			      n.frame = 0
			      n.acc = 0
			    }

			    // A click caught her mid-descent: the place she was passing becomes solid.
			    function perch(n, at) {
			      n.ground = clamp(at, GROUND, ceiling())
			      n.bottom = n.ground
			      n.fallV = 0
			      n.vx = 0
			      n.idleMs = 0
			      n.squash = SQUASH_LAND_MIN
			      n.squashV = 0
			      if (n.action === null) {
			        n.action = 'alert'
			        n.anim = 'alert'
			        n.frame = 0
			        n.acc = 0
			      }
			    }

			    function FoxPet() {
			      const [s, setS] = React.useState(initial)

			      React.useEffect(function () {
			        const doc = rootNode !== null ? rootNode.ownerDocument : null
			        const view = doc !== null && doc !== undefined ? doc.defaultView : null
			        if (view !== null && view !== undefined && typeof view.requestAnimationFrame === 'function') {
			          let handle = 0
			          let stopped = false
			          let last = nowMs()
			          function frame() {
			            if (stopped) return
			            const now = nowMs()
			            let dt = last > 0 && now > 0 ? now - last : TICK
			            if (dt < 1) dt = 1
			            if (dt > 100) dt = 100
			            last = now
			            setS(function (cur) { return tick(cur, dt) })
			            handle = view.requestAnimationFrame(frame)
			          }
			          handle = view.requestAnimationFrame(frame)
			          return function () {
			            stopped = true
			            if (view.cancelAnimationFrame) view.cancelAnimationFrame(handle)
			          }
			        }
			        return ctx.interval(function () {
			          setS(function (cur) { return tick(cur, TICK) })
			        }, TICK)
			      }, [])

			      React.useEffect(function () {
			        const doc = rootNode !== null ? rootNode.ownerDocument : null
			        const view = doc !== null && doc !== undefined ? doc.defaultView : null
			        if (rootNode === null || view === null || view === undefined) return undefined
			        if (typeof view.ResizeObserver !== 'function') return undefined
			        const observer = new view.ResizeObserver(function () {
			          const box = rootNode.getBoundingClientRect()
			          if (box.width > 0 && box.height > 0 && (box.width !== stageW || box.height !== stageH)) {
			            stageW = box.width
			            stageH = box.height
			            setS(function (cur) {
			              // A perched fox has bottom === ground, so if the overlay shrinks
			              // below her she never falls again and overflow: hidden clips her
			              // out of reach. Bring the vertical state inside the new ceiling.
			              const n = Object.assign({}, cur)
			              const cap = ceiling()
			              if (n.ground > cap) n.ground = cap
			              if (n.bottom > cap) n.bottom = cap
			              return n
			            })
			          }
			        })
			        observer.observe(rootNode)
			        return function () { observer.disconnect() }
			      }, [])

			      // Sleep and jump on the wheel. React attaches wheel passively, which would
			      // make preventDefault a no-op, so this is bound directly and non-passively.
			      React.useEffect(function () {
			        const node = foxNode
			        if (node === null || node === undefined || typeof node.addEventListener !== 'function') return undefined
			        function onWheel(e) {
			          if (e.preventDefault) e.preventDefault()
			          const down = e.deltaY > 0
			          setS(function (cur) {
			            const n = Object.assign({}, cur)
			            if (down) {
			              sleep(n)
			              return n
			            }
			            wake(n, null)
			            if (n.mode !== 'sleep' && n.hop === 0) {
			              n.hopV = JUMP_V
			              n.squash = -SQUASH_JUMP
			              n.squashV = 0
			              n.action = 'play'
			              n.anim = 'play'
			              n.frame = 0
			              n.acc = 0
			            }
			            return n
			          })
			        }
			        node.addEventListener('wheel', onWheel, { passive: false })
			        return function () { node.removeEventListener('wheel', onWheel) }
			      }, [])

			      function mutate(fn) {
			        setS(function (cur) {
			          const n = Object.assign({}, cur)
			          fn(n)
			          return n
			        })
			      }

			      const col = s.cell % COLS
			      const row = s.row

			      function endDrag() {
			        if (drag === null) return
			        drag = null
			        mutate(function (n) { n.drag = false })
			      }

			      function onPointerDown(e) {
			        // Middle button is the sleep gesture. Cancelling is safe at button 1:
			        // nothing depends on the compatibility mouse events for it, and it stops
			        // the browser's autoscroll/paste from starting on her.
			        if (e.button === 1) {
			          e.preventDefault()
			          mutate(function (n) {
			            if (n.mode === 'sleep') {
			              n.vx = 0
			              wake(n, null)
			            } else {
			              sleep(n)
			            }
			          })
			          return
			        }
			        if (e.button !== 0) return
			        // Deliberately no preventDefault on the left button: cancelling
			        // pointerdown suppresses the compatibility mouse events, which is what
			        // stopped dblclick (and so the sleep toggle) from ever firing.
			        const rect = e.currentTarget.getBoundingClientRect()
			        drag = {
			          id: e.pointerId,
			          w: rect.width > 0 ? rect.width : 1,
			          sx: e.clientX,
			          sy: e.clientY,
			          ox: s.x,
			          ob: s.bottom,
			          airborne: s.bottom > s.ground + 0.5,
			          lastX: e.clientX,
			          lastT: nowMs(),
			          vx: 0,
			          moved: 0,
			        }
			        if (e.currentTarget.setPointerCapture) {
			          try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) { /* unsupported */ }
			        }
			        // Cancel any in-flight hop: the hop block integrates regardless of drag,
			        // so grabbing her mid-leap left the sprite bobbing against the pointer.
			        mutate(function (n) {
			          n.drag = true
			          n.idleMs = 0
			          n.vx = 0
			          n.fallV = 0
			          n.hop = 0
			          n.hopV = 0
			        })
			      }

			      function onRootPointerMove(e) {
			        if (drag === null || e.pointerId !== drag.id) return
			        const rect = e.currentTarget.getBoundingClientRect()
			        const w = rect.width > 0 ? rect.width : drag.w
			        if (rect.width > 0) stageW = rect.width
			        if (rect.height > 0) stageH = rect.height
			        const dx = e.clientX - drag.sx
			        const dy = e.clientY - drag.sy
			        // Absolute values: compared as signed, an upward drag produced a negative
			        // dy that never exceeded `moved`, so lifting her straight up and letting
			        // go was misread as a click.
			        const adx = dx > 0 ? dx : -dx
			        const ady = dy > 0 ? dy : -dy
			        drag.moved = adx > ady ? adx : ady
			        const now = nowMs()
			        if (now > 0 && drag.lastT > 0) {
			          const dms = now - drag.lastT
			          if (dms >= 8) {
			            const v = (e.clientX - drag.lastX) / w / (dms / 1000)
			            drag.vx = drag.vx * 0.35 + v * 0.65
			            drag.lastX = e.clientX
			            drag.lastT = now
			          }
			        } else {
			          drag.lastX = e.clientX
			          drag.lastT = now
			        }
			        const eb = edgeBounds()
			        const nx = clamp(drag.ox + dx / w, eb.lo, eb.hi)
			        const nb = clamp(drag.ob - dy, 0, ceiling())
			        mutate(function (n) {
			          n.x = nx
			          n.bottom = nb
			          if (dx > 4) n.facing = 1
			          else if (dx < -4) n.facing = -1
			        })
			      }

			      function onRootPointerUp(e) {
			        if (drag === null || e.pointerId !== drag.id) return
			        const d = drag
			        drag = null
			        if (d.moved < 4) {
			          mutate(function (n) {
			            n.drag = false
			            // A click that caught her in the air is a perch, not a poke.
			            if (d.airborne) {
			              perch(n, n.bottom)
			              return
			            }
			            wake(n, 'greet')
			            if (n.hop === 0) n.hopV = 200
			          })
			          return
			        }
			        const vx = clamp(d.vx, -FLING_MAX, FLING_MAX)
			        mutate(function (n) {
			          n.drag = false
			          n.idleMs = 0
			          // Letting go puts the default floor back: the ledge only lasts until
			          // she is dropped again.
			          n.ground = GROUND
			          n.fallV = 0
			          if (n.mode === 'sleep') {
			            n.vx = 0
			            return
			          }
			          n.vx = vx
			          // A hard flick turns into a tumble, and overrides whatever she was
			          // doing: the spin is the direct consequence of the throw.
			          const speed = vx > 0 ? vx : -vx
			          if (speed > FLING_TUMBLE) {
			            n.action = 'spin'
			            n.anim = 'spin'
			            n.frame = 0
			            n.acc = 0
			          } else if (n.action === null && vx !== 0) {
			            n.anim = 'walk'
			            n.frame = 0
			            n.acc = 0
			          }
			          if (vx > 0.05) n.facing = 1
			          else if (vx < -0.05) n.facing = -1
			        })
			      }

			      function onDoubleClick(e) {
			        e.preventDefault()
			        mutate(function (n) {
			          if (n.mode === 'sleep') {
			            n.vx = 0
			            wake(n, null)
			          } else {
			            sleep(n)
			          }
			        })
			      }

			      function onContextMenu(e) {
			        e.preventDefault()
			        mutate(function (n) {
			          n.x = 0.5
			          n.ground = GROUND
			          n.bottom = GROUND
			          n.vx = 0
			          n.fallV = 0
			          n.hop = 0
			          n.hopV = 0
			          n.squash = 0
			          n.squashV = 0
			          wake(n, null)
			        })
			      }

			      function onFoxEnter(e) {
			        petX = e.clientX
			        petDir = 0
			        strokes = 0
			      }

			      function onFoxMove(e) {
			        if (drag !== null) return
			        const dx = e.clientX - petX
			        petX = e.clientX
			        if (dx > 2 || dx < -2) {
			          const dir = dx > 0 ? 1 : -1
			          if (petDir !== 0 && dir !== petDir) {
			            strokes += 1
			            if (strokes >= 4) {
			              strokes = 0
			              petDir = 0
			              mutate(function (n) {
			                n.idleMs = 0
			                if (n.mode !== 'sleep' && n.action === null) {
			                  n.action = 'play'
			                  n.anim = 'play'
			                  n.frame = 0
			                  n.acc = 0
			                  n.hopV = 340
			                  n.squash = -SQUASH_JUMP
			                  n.squashV = 0
			                }
			              })
			              return
			            }
			          }
			          petDir = dir
			        }
			      }

			      function onFoxLeave() {
			        strokes = 0
			        petDir = 0
			      }

			      function onImgLoad() {
			        mutate(function (n) { n.imgStatus = 'ok' })
			      }

			      function onImgError() {
			        mutate(function (n) {
			          n.imgStatus = 'failed'
			          if (n.src !== SHEET_REMOTE) n.src = SHEET_REMOTE
			        })
			      }

			      const rootStyle = {
			        position: 'absolute',
			        left: 0,
			        top: 0,
			        right: 0,
			        bottom: 0,
			        overflow: 'hidden',
			        pointerEvents: s.drag ? 'auto' : 'none',
			      }

			      // Height above whatever surface she is standing on drives the drift and
			      // the shadow's depth cue. A perched fox has lift 0 and a solid shadow.
			      const lift = s.bottom - s.ground
			      const depth = clamp(lift / 320, 0, 1)
			      const swayAmp = clamp(lift / 60, 0, 1) * FALL_SWAY_PX
			      const sway = lift > 0.5 ? Math.sin((s.swayPhase / FALL_SWAY_PERIOD) * 2 * Math.PI) * swayAmp : 0
			      const stretched = 1 + s.squash
			      const squashed = 1 - s.squash

			      const positioned = stageW > 0
			      const px = positioned ? s.x * stageW - CW / 2 + sway : 0

			      const foxStyle = {
			        position: 'absolute',
			        left: positioned ? 0 : (s.x * 100) + '%',
			        bottom: s.bottom + 'px',
			        width: CW + 'px',
			        height: CH + 'px',
			        transform: positioned
			          ? 'translate3d(' + px + 'px,0,0) scaleX(' + (s.facing * stretched) + ') scaleY(' + squashed + ')'
			          : 'translateX(-50%) scaleX(' + (s.facing * stretched) + ') scaleY(' + squashed + ')',
			        // Scale about her feet, so a squash never lifts her off the surface.
			        transformOrigin: '50% 100%',
			        pointerEvents: 'auto',
			        touchAction: 'none',
			        cursor: s.drag ? 'grabbing' : 'grab',
			        willChange: 'transform',
			        userSelect: 'none',
			        WebkitUserSelect: 'none',
			      }

			      const shadowStyle = {
			        position: 'absolute',
			        left: '50%',
			        bottom: '0px',
			        width: (CW * 0.62) + 'px',
			        height: (CW * 0.14) + 'px',
			        marginLeft: -(CW * 0.31) + 'px',
			        borderRadius: '50%',
			        background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.16) 55%, rgba(0,0,0,0) 100%)',
			        transform: 'scale(' + (1 - depth * 0.5) + ')',
			        opacity: 1 - depth * 0.55,
			        pointerEvents: 'none',
			      }

			      const clipStyle = {
			        position: 'absolute',
			        left: 0,
			        bottom: 0,
			        width: CW + 'px',
			        height: CH + 'px',
			        overflow: 'hidden',
			        transform: 'translate3d(0,' + (-s.hop) + 'px,0)',
			        pointerEvents: 'none',
			      }

			      const imgStyle = {
			        position: 'absolute',
			        left: 0,
			        top: 0,
			        display: 'block',
			        width: SHEET_W + 'px',
			        height: SHEET_H + 'px',
			        maxWidth: 'none',
			        maxHeight: 'none',
			        transform: 'translate3d(' + (-col * CW) + 'px,' + (-row * CH) + 'px,0)',
			        willChange: 'transform',
			        pointerEvents: 'none',
			        userSelect: 'none',
			        WebkitUserSelect: 'none',
			      }

			      const fallbackStyle = {
			        position: 'absolute',
			        left: 0,
			        bottom: 0,
			        width: CW + 'px',
			        height: CH + 'px',
			        display: 'flex',
			        alignItems: 'flex-end',
			        justifyContent: 'center',
			        fontSize: '44px',
			        lineHeight: 1,
			        border: '1px dashed rgba(120, 170, 255, 0.9)',
			        borderRadius: '8px',
			        color: '#fff',
			      }

			      const probeStyle = {
			        position: 'absolute',
			        left: 0,
			        top: 0,
			        width: '1px',
			        height: '1px',
			        opacity: 0,
			        pointerEvents: 'none',
			      }

			      const inner = s.imgStatus === 'failed'
			        ? React.createElement('div', { style: fallbackStyle }, '\uD83E\uDD8A')
			        : React.createElement(
			            'div',
			            { style: clipStyle },
			            React.createElement('img', {
			              src: s.src,
			              alt: '',
			              draggable: false,
			              style: imgStyle,
			            }),
			          )

			      return React.createElement(
			        'div',
			        {
			          ref: function (node) {
			            if (node === null) return
			            rootNode = node
			            if (!measured) {
			              measured = true
			              const box = node.getBoundingClientRect()
			              if (box.width > 0 && box.height > 0) {
			                stageW = box.width
			                stageH = box.height
			                setS(function (cur) { return Object.assign({}, cur) })
			              }
			            }
			          },
			          'data-fox-pet': 'root',
			          style: rootStyle,
			          onPointerMove: onRootPointerMove,
			          onPointerUp: onRootPointerUp,
			          onPointerCancel: onRootPointerUp,
			        },
			        React.createElement(
			          'div',
			          {
			            ref: function (node) { foxNode = node },
			            'data-fox-pet': 'fox',
			            style: foxStyle,
			            title: 'Folio the fox \u2014 click to poke her \u00b7 double-click or middle-click to tuck her in \u00b7 scroll down for sleep, up for a leap \u00b7 drag her anywhere and let go to drop her \u00b7 catch her mid-fall with a click to perch her there \u00b7 stroke her fur to play \u00b7 right-click to bring her home',
			            onPointerDown: onPointerDown,
			            onLostPointerCapture: endDrag,
			            onDoubleClick: onDoubleClick,
			            onContextMenu: onContextMenu,
			            onMouseEnter: onFoxEnter,
			            onMouseMove: onFoxMove,
			            onMouseLeave: onFoxLeave,
			          },
			          React.createElement('div', { style: shadowStyle }),
			          inner,
			        ),
			        React.createElement('img', {
			          src: s.src,
			          alt: '',
			          draggable: false,
			          onLoad: onImgLoad,
			          onError: onImgError,
			          style: probeStyle,
			        }),
			      )
			    }

			    slots.inject('shell.overlay', function () {
			      return slots.register(
			        { name: 'shell.overlay', id: 'fox-pet-folio', order: 40, label: 'Folio the fox' },
			        FoxPet,
			      )
			    })
			  },
			}
		})();
		exports.apply = plugin.apply;
		exports.inject = plugin.inject;
		return module.exports;
	}
});
