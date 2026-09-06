import QtQuick
import Quickshell

Item {
  Service { id: fox }
  property int stage: 0
  property real started: 0
  property var frames: []
  function check(condition, label) {
    if (!condition) console.log("HARNESS_FAIL", label)
  }
  Timer {
    interval: 20
    running: true
    repeat: true
    onTriggered: {
      if (stage === 0) {
        if (!fox.petMetaLoaded || !fox.stateDirCreated) return
        fox.enabled = true
        fox.physicsEnabled = false
        fox.resetPosition()
        fox.startAction(fox.stateIdle, 0)
        check(!fox.previewMode, "checks exercise normal user interaction")
        check(fox.durationFor(fox.stateGreet) === 660, "normal greet uses authored duration")
        fox.startAction("walk", 0)
        fox.velocityX = fox.walkSpeed
        fox.poke()
        fox.animationStep(1000)
        check(fox.petState === "greet" && fox.frameIndex === 0,
              "braking does not consume the wave")
        while (fox.velocityX > 0) fox.physicsStep(16)
        fox.animationStep(659)
        check(fox.spriteState === "greet" && fox.spriteFrame === 3, "wave reaches lowered paw after braking")
        fox.animationStep(1)
        check(fox.petState === "idle", "wave finishes without wrapping")
        fox.startAction("sitLeft", 0)
        fox.animationStep(720)
        fox.poke()
        fox.animationStep(720)
        check(fox.petState === "greet" && fox.spriteFrame === 0, "standing up does not consume the wave")
        fox.animationStep(2000)
        check(fox.petState === "idle", "delayed frame callback still completes one wave")
        fox.applyPetMeta(JSON.stringify({sprite: {rows: {greet: {row: 3, frames: 4, fps: 10}}}}))
        fox.poke()
        fox.animationStep(400)
        check(fox.petState === "idle", "fps-only wave also completes once")
        fox.applyPetMeta(__PET_META__)
        fox.sleepNow()
        fox.animationStep(960)
        fox.poke()
        fox.animationStep(240)
        var frame = fox.spriteFrame
        fox.poke()
        check(fox.sleepTransition === "wake" && fox.spriteFrame === frame,
              "repeated poke preserves wake progress")
        fox.sleepNow()
        fox.animationStep(960)
        fox.sleepToggle()
        frames = [fox.spriteFrame]
        started = Date.now()
        stage = 1
      } else if (stage === 1) {
        if (fox.sleepTransition === "wake") {
          if (frames[frames.length - 1] !== fox.spriteFrame) frames.push(fox.spriteFrame)
        } else {
          check(JSON.stringify(frames) === JSON.stringify([4, 0, 1, 2]), "wake renders each rising pose in order")
          check(fox.petState === "idle" && !fox.manualSleep && fox.positionY === fox.groundY,
                "wake returns to grounded awake idle")
          check(Date.now() - started >= 900 && Date.now() - started < 1200, "wake lasts approximately 960ms")
          fox.poke()
          frames = [fox.spriteFrame]
          started = Date.now()
          stage = 2
        }
      } else if (stage === 2) {
        if (fox.petState === "greet") {
          if (frames[frames.length - 1] !== fox.spriteFrame) frames.push(fox.spriteFrame)
        } else {
          check(JSON.stringify(frames) === JSON.stringify([0, 1, 2, 1, 3]), "normal click plays one complete paw wave")
          check(fox.petState === "idle", "greet settles to idle")
          check(Date.now() - started >= 620 && Date.now() - started < 850, "normal greet completes at authored duration")
          fox.disable()
          console.log("HARNESS_DONE")
          stop()
        }
      }
    }
  }
}
