#!/usr/bin/env python3
"""Black-box movement tests against the real QML service.

The Python regression tests cover data contracts. This module starts one
headless Quickshell instance, calls Service.qml's deterministic physics step,
and asserts the observable state transitions. No movement logic is copied into
the test, so a change in Service.qml is what makes these tests fail or pass.
"""

import json
import os
import selectors
import shutil
import subprocess
import tempfile
import textwrap
import time
import unittest
from pathlib import Path


HARNESS = textwrap.dedent(
    r'''
    import QtQuick
    import Quickshell

    Item {
      id: root
      Service { id: fox }

      function check(condition, label) {
        if (condition) console.log("HARNESS_PASS", label)
        else console.log("HARNESS_FAIL", label)
      }

      function closeEnough(actual, expected) {
        return Math.abs(actual - expected) < 0.0001
      }

      Component.onCompleted: {
        fox.applyPetMeta(__PET_META__)
        check(fox.rows.idle.frames === 7 && fox.rows.play.frames === 6
              && fox.rows.think.frames === 6 && fox.rows.alert.frames === 6,
              "metadata excludes empty trailing cells")
        // Keep the scheduler out of these checks; each test advances the real
        // production step exactly once.
        fox.enabled = false
        fox.physicsEnabled = false
        fox.recomputeGround()

        fox.positionX = 200
        fox.positionY = 300
        fox.velocityX = 2
        fox.velocityY = 0
        fox.physicsStep()
        check(closeEnough(fox.positionX, 201.88), "step eases horizontal momentum")
        check(closeEnough(fox.positionY, 300 + fox.gravity), "step applies gravity")

        fox.positionX = 0
        fox.positionY = 300
        fox.velocityX = -4
        fox.velocityY = 0
        fox.direction = -1
        fox.physicsStep()
        check(fox.positionX === fox.edgeMargin, "left wall clamps to edge margin")
        check(fox.direction === 1 && fox.velocityX === 0,
              "left wall turns at rest")

        var screenGeometry = fox.screenGeometry(fox.currentScreen())
        var rightEdge = screenGeometry.width - fox.cellWidth * fox.scale - fox.edgeMargin
        fox.positionX = rightEdge + 2
        fox.positionY = 300
        fox.velocityX = 4
        fox.velocityY = 0
        fox.physicsStep()
        check(closeEnough(fox.positionX, rightEdge), "right wall clamps to edge margin")
        check(fox.direction === -1 && fox.velocityX === 0,
              "right wall turns at rest")

        fox.positionX = 200
        fox.positionY = fox.groundY
        fox.velocityX = 0
        fox.velocityY = 4
        fox.physicsStep()
        check(fox.velocityY === 0, "fast landing never rebounds")
        check(fox.positionY === fox.groundY && fox.movementPhase === "contact",
              "floor crossing enters contact without penetration")

        fox.petState = fox.statePlay
        fox.isJumping = true
        fox.positionY = fox.groundY
        fox.velocityY = 0.5
        fox.physicsStep()
        check(fox.isJumping, "contact retains jump guard until settled")
        check(fox.positionY === fox.groundY && fox.velocityY === 0,
              "soft landing settles on ground")
        for (var settle = 0; settle < Math.ceil(fox.contactDuration / 16); settle++) fox.physicsStep()
        check(fox.movementPhase === "settling" && fox.landingSquash > 0.059,
              "contact compresses into settling")
        var compression = fox.landingSquash
        for (var release = 0; release < Math.ceil(fox.settleDuration / 16); release++) {
          fox.physicsStep()
          check(fox.landingSquash <= compression, "settling releases monotonically")
          check(fox.positionY === fox.groundY, "settling stays planted")
          compression = fox.landingSquash
        }
        check(fox.movementPhase === "grounded" && !fox.isJumping && fox.landingSquash === 0,
              "settling completes with neutral transform")

        fox.positionY = fox.groundY - 450
        fox.velocityY = 0
        fox.petState = fox.stateIdle
        var lastY = fox.positionY
        var reachedCruise = false
        var braked = false
        for (var fall = 0; fall < 300 && fox.positionY < fox.groundY; fall++) {
          var previousSpeed = fox.velocityY
          fox.physicsStep()
          check(fox.positionY >= lastY && fox.positionY <= fox.groundY,
                "fall is monotonic and never penetrates floor")
          check(fox.velocityY >= 0 && fox.velocityY <= fox.maxFallSpeed,
                "fall speed is bounded")
          reachedCruise = reachedCruise || fox.velocityY > fox.maxFallSpeed * 0.95
          braked = braked || (previousSpeed > fox.velocityY && fox.positionY < fox.groundY)
          lastY = fox.positionY
        }
        check(reachedCruise && braked && fox.movementPhase === "contact",
              "tall fall cruises then brakes into contact")
        for (var rest = 0; rest < Math.ceil((fox.contactDuration + fox.settleDuration) / 16); rest++) fox.physicsStep()

        fox.petState = fox.stateIdle
        fox.positionX = 200
        fox.positionY = fox.groundY
        fox.velocityX = 0
        fox.velocityY = 0
        fox.jump()
        check(fox.isJumping && fox.petState === fox.statePlay,
              "jump enters play state")
        check(fox.velocityY === fox.jumpImpulse, "jump applies impulse")
        check(fox.spriteSpec.row === fox.rows.idle.row && fox.spriteFrame === 0,
              "rising holds the body pose used for landing")
        var jumpVelocity = fox.velocityY
        fox.jump()
        check(fox.velocityY === jumpVelocity, "second jump is ignored in flight")
        for (var flight = 0; flight < 200 && fox.movementPhase !== "grounded"; flight++) {
          fox.physicsStep()
          if (fox.movementPhase === "falling")
            check(fox.spriteFrame === 0, "descent holds upright landing pose")
          if (fox.movementPhase === "contact" || fox.movementPhase === "settling")
            check(fox.spriteState === fox.stateIdle && fox.spriteFrame === 0,
                  "landing holds settled standing sprite")
        }
        check(!fox.isJumping && fox.petState === fox.stateIdle, "jump finishes through settling")

        fox.petState = fox.stateIdle
        fox.velocityX = -2
        fox.setState(fox.stateWalk)
        check(fox.direction === -1 && fox.velocityX === -2,
              "walk preserves existing momentum direction")
        fox.setState(fox.stateIdle)
        check(fox.velocityX === -2, "non-walk state preserves momentum for braking")
        for (var brake = 0; brake < 20; brake++) fox.physicsStep()
        check(fox.velocityX === 0, "non-walk state smoothly stops")

        fox.positionX = rightEdge - 20
        fox.direction = 1
        fox.setState(fox.stateWalk)
        var turned = false
        var oldVx = fox.velocityX
        for (var walk = 0; walk < 120; walk++) {
          fox.physicsStep()
          check(Math.abs(fox.velocityX - oldVx) <= fox.horizontalAcceleration + 0.0001,
                "walking and wall turns bound acceleration")
          check(fox.positionX <= rightEdge, "wall turn remains in bounds")
          turned = turned || fox.direction === -1
          oldVx = fox.velocityX
        }
        check(turned && fox.velocityX < 0, "wall turn resumes inward walk")

        fox.positionX = 200
        fox.direction = 1
        fox.velocityX = fox.walkSpeed
        fox.setState(fox.stateWalk)
        fox.walkDistance = 0
        fox.animationElapsed = 0
        var strideFrames = []
        for (var stride = 0; stride < 6; stride++) {
          strideFrames.push(fox.spriteFrame)
          fox.physicsStep(25)
          fox.physicsStep(25)
          fox.physicsStep(25)
          fox.physicsStep(25)
          fox.physicsStep(25)
        }
        check(JSON.stringify(strideFrames) === JSON.stringify([1, 2, 3, 4, 5, 6]),
              "running loops only through active stride poses")
        check(fox.spriteFrame === 1, "running loops directly into the next stride")

        for (var cadence of [1000 / 30, 1000 / 60, 1000 / 144, 75]) {
          fox.positionX = 200
          fox.velocityX = fox.walkSpeed
          fox.walkDistance = 0
          var remainingTime = 1000
          while (remainingTime > 0.000001) {
            var elapsed = Math.min(cadence, remainingTime)
            fox.physicsStep(elapsed)
            remainingTime -= elapsed
          }
          check(closeEnough(fox.positionX - 200, fox.walkSpeed * 1000 / 16),
                "cruise distance is independent of presentation cadence " + cadence)
          check(closeEnough(fox.walkDistance, fox.positionX - 200),
                "stride clock matches actual displacement")
        }

        // Observe every presentation step, including slow starts, braking,
        // a reversal and a pending sleep transition. No planted/turn cells
        // may leak into a moving stride at any display refresh rate.
        for (var hz of [30, 60, 144]) {
          fox.velocityX = 0
          fox.setState(fox.stateIdle)
          fox.positionX = rightEdge - 40
          fox.positionY = fox.groundY
          fox.direction = 1
          fox.setState(fox.stateWalk)
          var reversed = false
          for (var step = 0; step < hz * 3; step++) {
            var beforeX = fox.positionX
            fox.physicsStep(1000 / hz)
            fox.animationStep(1000 / hz)
            reversed = reversed || fox.direction === -1
            check(fox.spriteSpec.row === 1 && fox.spriteFrame >= 1 && fox.spriteFrame <= 6,
                  "walk contains only stride artwork at " + hz + "Hz")
            check(Math.abs(fox.positionX - beforeX) <= fox.walkSpeed * 1000 / hz / 16 + 0.001,
                  "walk position is continuous at " + hz + "Hz")
          }
          check(reversed, "wall reversal completes at " + hz + "Hz")
          fox.setState(fox.stateSleep)
          while (Math.abs(fox.velocityX) > 0.01) {
            fox.physicsStep(1000 / hz)
            if (Math.abs(fox.velocityX) > 0.01)
              check(fox.spriteSpec.row === 1 && fox.spriteFrame >= 1 && fox.spriteFrame <= 6,
                    "pending sleep never replaces a moving stride")
          }
          fox.setState(fox.stateIdle)
          fox.animationStep(960) // finish the wake transition before next case
        }

        fox.velocityX = 0
        fox.setState(fox.stateIdle)
        fox.animationStep(450)
        check(fox.frameIndex === 0 && closeEnough(fox.animationElapsed, 450),
              "idle holds its stable body pose between blinks")
        fox.setState(fox.stateGreet)
        fox.animationStep(100)
        fox.animationStep(150)
        check(fox.frameIndex === 2, "animation accepts partitioned elapsed time")
        fox.setState(fox.stateGreet)
        fox.animationStep(250)
        check(fox.frameIndex === 2, "animation partitions produce identical frame")
        var frame = fox.frameIndex
        for (var tick = 0; tick < 10; tick++) fox.physicsStep()
        check(fox.frameIndex === frame, "physics does not advance sprite clock")
        fox.setState(fox.stateIdle)
        fox.animationStep(3890)
        check(fox.spriteFrame === 0, "blink cycle returns to standing pose")

        fox.enabled = true
        fox.direction = -1
        fox.visualDirection = -1
        fox.spin()
        check(fox.turnStep === -1 && fox.spinFromDir === -1 && fox.spriteFrame === 6,
              "spin starts from the current left profile without a stray yaw")
        fox.animationStep(1440)
        check(fox.frameIndex === 8 && fox.spriteFrame === 6,
              "spin completes one revolution at the same profile")
        fox.startAction(fox.stateIdle, 0)

        fox.direction = -1
        fox.visualDirection = -1
        fox.setState(fox.stateGreet)
        check(fox.direction === 1 && fox.turnStep === -1,
              "front-facing emote normalization does not flash turnaround frames")

        fox.setState(fox.stateIdle)
        fox.direction = 1
        fox.visualDirection = 1
        fox.pointerGlanceDirection = -1
        fox.pointerNear = false
        fox.pointerNear = true
        check(fox.direction === -1 && fox.visualDirection === -1 && fox.turnStep === -1,
              "hover glance changes facing without a side-profile head jump")

        fox.petState = fox.stateWalk
        fox.manualSleep = false
        fox.isDragging = true
        fox.positionY = 300
        fox.velocityX = 4
        fox.velocityY = 3
        fox.settleDrop(500)
        check(!fox.isDragging && fox.velocityX === 0, "drop ends drag and toss")
        check(fox.velocityY === 0 && fox.petState === fox.stateIdle,
              "awake drop settles into idle")

        fox.petState = fox.stateSleep
        fox.manualSleep = true
        fox.isDragging = true
        fox.positionY = 300
        fox.settleDrop(500)
        check(fox.petState === fox.stateSleep && fox.manualSleep,
              "sleeping drop preserves sleep")
        for (var sleepingFall = 0; sleepingFall < 300; sleepingFall++) fox.physicsStep()
        check(fox.spriteState === fox.stateSleep && fox.landingSquash === 0
              && fox.positionY === fox.groundY, "sleeping drop settles without waking or deforming")
        fox.sleepNow()
        check(fox.movementPhase === "grounded" && !fox.isJumping,
              "explicit sleep clears transient movement")
        fox.manualSleep = false
        fox.jump()
        fox.resetPosition()
        check(fox.movementPhase === "grounded" && fox.landingSquash === 0,
              "reset clears transient movement")

        fox.disable()
        console.log("HARNESS_DONE")
      }
    }
    '''
)


class TestQmlMovement(unittest.TestCase):
    def test_real_service_movement(self):
        self.run_harness(HARNESS)

    def test_timer_driven_walk_renderer(self):
        self.run_harness(Path(__file__).with_name("WalkRuntime.qml").read_text())

    def test_greeting_and_wake_interactions(self):
        self.run_harness(Path(__file__).with_name("GreetingWakeRuntime.qml").read_text())

    def test_preview_and_metadata_reload(self):
        self.run_harness(Path(__file__).with_name("PreviewRuntime.qml").read_text(), private_assets=True)

    def run_harness(self, harness, private_assets=False):
        repo_root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="fox-pet-qml-test-") as temp:
            temp_root = Path(temp)
            shutil.copy2(repo_root / "Service.qml", temp_root / "Service.qml")
            shutil.copy2(repo_root / "SpriteView.qml", temp_root / "SpriteView.qml")
            if private_assets:
                shutil.copytree(repo_root / "assets", temp_root / "assets")
            else:
                (temp_root / "assets").symlink_to(repo_root / "assets")

            # Service.qml imports the host's qs.Commons module. The movement
            # service does not use a Commons symbol, so a minimal local module
            # keeps this test independent of a full Omarchy installation.
            commons = temp_root / "Commons"
            commons.mkdir()
            (commons / "qmldir").write_text(
                "module qs.Commons\nUtil 1.0 Util.qml\n", encoding="utf-8"
            )
            (commons / "Util.qml").write_text(
                "import QtQml\nQtObject {}\n", encoding="utf-8"
            )
            harness_path = temp_root / "MovementHarness.qml"
            harness_path.write_text(
                harness.replace("__PET_META__", json.dumps(
                    (repo_root / "assets/pet.json").read_text(encoding="utf-8")
                )), encoding="utf-8"
            )

            env = os.environ.copy()
            env["HOME"] = str(temp_root)
            env.pop("WAYLAND_DISPLAY", None)
            env["QT_QPA_PLATFORM"] = "offscreen"
            env["QT_QPA_PLATFORMTHEME"] = ""
            env["QT_QUICK_BACKEND"] = "software"
            env["XDG_RUNTIME_DIR"] = str(temp_root)

            process = subprocess.Popen(
                ["quickshell", "-p", str(harness_path)],
                cwd=temp_root,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            output = []
            deadline = time.monotonic() + 8
            selector = selectors.DefaultSelector()
            selector.register(process.stdout, selectors.EVENT_READ)
            try:
                while time.monotonic() < deadline:
                    ready = selector.select(max(0, deadline - time.monotonic()))
                    if not ready:
                        break
                    line = process.stdout.readline()
                    if not line:
                        if process.poll() is not None:
                            break
                        continue
                    output.append(line)
                    if "HARNESS_IPC_READY" in line:
                        def ipc(*args):
                            result = subprocess.run(
                                ["quickshell", "ipc", "--pid", str(process.pid),
                                 "call", "fox-pet", *args],
                                env=env, capture_output=True, text=True, timeout=2,
                            )
                            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                            return result.stdout.strip()

                        self.assertEqual(ipc("preview", "walk", "-1"), "ok")
                        state = json.loads(ipc("debugState"))
                        self.assertTrue(state["previewMode"])
                        self.assertEqual(state["requestedAction"], "walk")
                        self.assertEqual(state["facing"], -1)
                        self.assertIn("loading", ipc("reloadAnimationMeta"))
                        self.assertEqual(ipc("resume"), "ok")
                        self.assertFalse(json.loads(ipc("debugState"))["previewMode"])
                        self.assertEqual(ipc("disable"), "off")
                    if "HARNESS_DONE" in line:
                        break
                else:
                    self.fail("QML movement harness timed out\n" + "".join(output))
            finally:
                selector.close()
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=2)
                process.stdout.close()

            transcript = "".join(output)
            failures = [line for line in output if "HARNESS_FAIL" in line]
            self.assertTrue(
                "HARNESS_DONE" in transcript,
                "QML movement harness did not complete\n" + transcript,
            )
            self.assertFalse(
                failures,
                "\n".join(failures) + "\nFull output:\n" + transcript,
            )


if __name__ == "__main__":
    unittest.main()
