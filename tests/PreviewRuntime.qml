import QtQuick
import Quickshell
import Quickshell.Io

Item {
  Service { id: fox }
  property int stage: 0
  property int ticks: 0
  property var original: JSON.parse(__PET_META__)
  property var savedRows
  function check(condition, label) {
    if (!condition) console.log("HARNESS_FAIL", label)
  }

  // The Python harness provides a private assets copy for this test.
  FileView {
    id: metadataWriter
    path: Qt.resolvedUrl("assets/pet.json")
    onSaved: fox.reloadAnimationMeta()
  }

  Timer {
    interval: 100
    running: true
    repeat: true
    onTriggered: {
      ticks++
      if (stage === 0) {
        if (!fox.petMetaLoaded || !fox.stateDirCreated) return
        fox.enabled = true
        fox.physicsEnabled = true
        for (var facing of [1, -1]) {
          check(fox.preview("walk", facing) === "ok", "walk preview accepted")
          fox.physicsStep(160)
          check(fox.velocityX * facing > 0 && fox.spriteFacing === facing, "walk direction")
          fox.preview("walk", facing)
          check(fox.velocityX === 0 && fox.walkDistance === 0 && fox.positionY === fox.groundY,
                "repeated walk starts grounded and stationary")
          fox.preview("spin", facing)
          check(fox.spriteFrame === (facing === 1 ? 2 : 6), "spin starts on authored profile")
        }
        fox.preview("sleep", -1)
        fox.animationStep(960)
        check(fox.manualSleep && fox.spriteState === "sleep", "sleep preview curls and holds")
        fox.poke()
        fox.animationStep(960)
        check(fox.petState === "idle" && !fox.manualSleep && !JSON.parse(fox.debugState()).actionTimerRunning,
              "wake finishes at held idle")
        fox.preview("jump", 1)
        for (var i = 0; i < 400 && fox.movementPhase !== "grounded"; i++) fox.physicsStep(16)
        check(fox.movementPhase === "grounded" && fox.petState === "idle"
              && !JSON.parse(fox.debugState()).actionTimerRunning, "jump lands at held idle")
        fox.preview("jump", 1)
        fox.preview("sitLeft", -1)
        fox.animationStep(720)
        check(!fox.isJumping && fox.movementPhase === "grounded" && fox.sitFrame === 0,
              "preview interrupts flight and completes sit")
        var before = fox.debugState()
        check(fox.preview("missing", 1).indexOf("error:") === 0 && fox.debugState() === before,
              "invalid action leaves state intact")
        check(fox.preview("idle", 0).indexOf("error:") === 0 && fox.debugState() === before,
              "invalid direction leaves state intact")
        fox.beginDrag()
        before = fox.debugState()
        check(fox.preview("idle", 1).indexOf("error:") === 0 && fox.resume().indexOf("error:") === 0
              && fox.debugState() === before, "drag rejects preview and resume")
        fox.settleDrop()
        fox.physicsEnabled = false
        check(fox.preview("jump", 1).indexOf("error:") === 0, "disabled physics rejects jump")
        fox.physicsEnabled = true

        savedRows = fox.rows
        for (var bad of [
          {frames: 9}, {row: -1}, {row: 11}, {fps: 0}, {fps: -1},
          {sequence: []}, {sequence: [99]}, {durations: [10]},
          {durations: [80, 90, 0, 90, 140]}, {durations: [80, 90, -1, 90, 140]}
        ]) {
          var candidate = JSON.parse(JSON.stringify(original))
          candidate.displayName = "must not commit"
          Object.assign(candidate.sprite.rows.greet, bad)
          check(!fox.applyPetMeta(JSON.stringify(candidate)) && fox.rows === savedRows
                && fox.petDisplayName === original.displayName, "invalid metadata is atomic")
        }
        check(!fox.applyPetMeta("{") && fox.rows === savedRows, "invalid JSON retains metadata")
        fox.applyPetMeta(__PET_META__)
        fox.preview("greet", -1)
        var debug = JSON.parse(fox.debugState())
        check(debug.requestedAction === "greet" && debug.row === 3 && debug.column === 0
              && debug.facing === 1, "debug exposes actual authored facing")
        fox.preview("greet", 1)
        fox.animationStep(659)
        check(fox.petState === fox.stateGreet && fox.frameIndex === 4,
              "greet holds its final authored frame before completion")
        fox.animationStep(1)
        check(fox.petState === fox.stateIdle && fox.frameIndex === 0,
              "greet completes exactly at authored duration")
        fox.preview("greet", 1)
        stage = 1
        ticks = 0
      } else if (stage === 1 && ticks >= 9) {
        check(fox.previewMode && fox.petState === "idle" && !JSON.parse(fox.debugState()).actionTimerRunning,
              "real action timer completes clip without selecting AI action")
        stage = 2
        ticks = 0
      } else if (stage === 2 && ticks >= 3) {
        check(fox.petState === "idle", "idle remains held")
        fox.preview("greet", 1)
        check(fox.spriteFrame === 0 && fox.animationElapsed === 0, "repeated greet restarts")
        fox.resume()
        check(!fox.previewMode && fox.petState === "idle" && JSON.parse(fox.debugState()).actionTimerRunning,
              "resume restores autonomous scheduling")
        fox.preview("sleep", 1)
        fox.disable()
        check(!fox.previewMode && fox.previewAction === "", "disable clears development mode")
        check(fox.preview("idle", 1).indexOf("error:") === 0, "disabled pet rejects preview")

        var updated = JSON.parse(JSON.stringify(original))
        updated.sprite.rows.greet.durations = [20, 20, 20, 20, 20]
        metadataWriter.setText(JSON.stringify(updated))
        stage = 3
      } else if (stage === 3 && fox.rows.greet.durations[0] === 20) {
        check(fox.metadataStatus === "ok", "asynchronous reload commits changed disk metadata")
        savedRows = fox.rows
        metadataWriter.setText("{")
        stage = 4
      } else if (stage === 4 && fox.metadataStatus.indexOf("error:") === 0) {
        check(fox.rows === savedRows, "failed reload keeps working rows")
        metadataWriter.setText(JSON.stringify(original))
        stage = 5
      } else if (stage === 5 && fox.rows.greet.durations[0] === original.sprite.rows.greet.durations[0]) {
        check(fox.metadataStatus === "ok", "reload recovers after error")
        fox.enabled = true
        stage = 6
        console.log("HARNESS_IPC_READY")
      } else if (stage === 6 && !fox.enabled) {
        stop()
        console.log("HARNESS_DONE")
      }
    }
  }
}
