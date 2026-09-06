import QtQuick
import QtQuick.Window
import Quickshell

Window {
  width: 900
  height: 260
  visible: true
  color: "#30343b"
  Service { id: fox }
  SpriteView {
    id: sprite
    x: fox.positionX
    y: 20
    width: fox.cellWidth
    height: fox.cellHeight
    source: fox.spriteUrl
    frameRow: fox.spriteSpec.row
    frameCol: fox.spriteFrame
    facing: fox.spriteFacing
    frameOffsetY: fox.spriteOffsetY
    walking: fox.spriteState === fox.stateWalk
    isTurning: fox.turnStep >= 0
    tiltDeg: fox.tiltDeg
  }
  property int observations: 0
  property bool reversed: false
  property var seen: ({})
  property real previousX: 0
  function check(condition, label) {
    if (!condition) console.log("HARNESS_FAIL", label)
  }
  Timer {
    interval: 100
    running: true
    onTriggered: {
      fox.recomputeGround()
      fox.positionY = fox.groundY
      fox.positionX = fox.screenGeometry(fox.currentScreen()).width - fox.cellWidth - fox.edgeMargin - 90
      previousX = fox.positionX
      fox.direction = 1
      fox.enabled = true
      fox.startAction(fox.stateWalk, 0)
      observe.start()
    }
  }
  Timer {
    id: observe
    interval: 16
    repeat: true
    onTriggered: {
      observations++
      reversed = reversed || fox.direction === -1
      seen[fox.spriteFrame] = true
      check(fox.spriteSpec.row === 1 && fox.spriteFrame >= 1 && fox.spriteFrame <= 6,
            "real timer walk selected unrelated art")
      check(sprite.currentRow === 1 && sprite.currentFrame >= 1 && sprite.currentFrame <= 6
            && sprite.poseMix === 1, "rendered walk contains a stale row, planted pose or dissolve")
      check(Math.abs(fox.positionX - previousX) < 5, "real timer movement jumped")
      previousX = fox.positionX
      if (observations >= 240) {
        check(reversed, "real timer walk did not reverse")
        check(Object.keys(seen).length === 6, "real timer walk did not render all six poses")
        fox.disable()
        console.log("HARNESS_DONE")
        stop()
      }
    }
  }
}
