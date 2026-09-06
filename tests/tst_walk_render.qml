import QtQuick
import QtTest
import ".."

Item {
  width: 420
  height: 240
  SpriteView {
    id: sprite
    width: 192
    height: 208
    source: Qt.resolvedUrl("../assets/spritesheet.webp")
    walking: true
    frameRow: 1
    frameCol: 1
    // Deliberately retain the motion values supplied by the service.
    // They must never distort the authored walk frames.
    tiltDeg: 8
  }
  Image {
    id: reference
    x: 220
    width: 192
    height: 208
    source: "../assets/spritesheet.webp"
    sourceClipRect: Qt.rect(sprite.frameCol * 192, sprite.frameRow * 208, 192, 208)
    transform: Scale { origin.x: 96; xScale: sprite.facing }
  }
  TestCase {
    name: "WalkPixels"
    when: windowShown
    function test_pose_transitions_stay_opaque() {
      sprite.walking = false
      sprite.tiltDeg = 0
      sprite.facing = 1
      tryCompare(reference, "status", Image.Ready)
      // Inspect during the former fade window, including interrupted row
      // changes. Every pixel must match a single authored pose, alpha included.
      for (var pose of [[0, 0], [3, 0], [3, 1], [3, 2], [3, 1], [3, 3],
                        [5, 3], [4, 4], [4, 0], [4, 1], [4, 2], [0, 0]]) {
        sprite.frameRow = pose[0]
        sprite.frameCol = pose[1]
        wait(20)
        verify(grabImage(sprite).equals(grabImage(reference)),
               "transition to " + pose + " must not fade or retain an old silhouette")
      }
    }
    function test_stride_pixels() {
      sprite.walking = true
      sprite.frameRow = 1
      sprite.tiltDeg = 8
      tryCompare(reference, "status", Image.Ready)
      for (var facing of [1, -1]) {
        sprite.facing = facing
        for (var col = 1; col <= 6; col++) {
          sprite.frameCol = col
          wait(30)
          verify(grabImage(sprite).equals(grabImage(reference)),
                 "walk " + col + " facing " + facing + " must be exactly its atlas crop")
        }
      }
    }
    function test_entry_is_atomic() {
      sprite.walking = false
      sprite.tiltDeg = 0
      sprite.frameRow = 0
      sprite.frameCol = 5
      wait(450)
      sprite.frameRow = 1
      sprite.frameCol = 1
      sprite.walking = true
      wait(20)
      verify(grabImage(sprite).equals(grabImage(reference)),
             "walk entry must not retain the old row or an intermediate column")
    }
  }
}
