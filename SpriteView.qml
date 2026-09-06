pragma ComponentBehavior: Bound
import QtQuick

// One full-opacity atlas cell: blending translucent poses causes ghosting.
// All deformation pivots around the paws, leaving placement and input alone.
//
// Procedural in-betweens fill the gaps:
// - Turnaround is handled cleanly via Row 9 rotational frames in Service.qml.
// - Facing is strictly discrete (+1 or -1), completely eliminating coin-flip distortions.
// - Walking uses the authored poses without extra deformation or dissolves.
// - Subtle breathing cycles continuously while idle or sleeping.
Item {
  id: root

  property url source
  property int columns: 8
  property int rowCount: 11
  property int cellWidth: 192
  property int cellHeight: 208
  property int frameRow: 0
  property int frameCol: 0
  property real frameOffsetY: 0
  property real facing: 1
  property bool walking: false
  property real tiltDeg: 0
  property real squash: 0
  property bool suspended: false
  property bool sleeping: false
  property bool breathing: false
  property bool emoteSway: false
  property bool active: true
  property bool dragging: false

  property int currentRow: -1
  property int currentFrame: 0
  property real currentOffset: 0
  property real breath: 0
  property real stretch: suspended && !sleeping ? 0.025 : 0
  property real sway: 0
  property bool ready: false

  function updatePose() {
    if (!ready) return
    currentRow = frameRow
    currentFrame = frameCol
    currentOffset = frameOffsetY
  }

  // Row, column and facing bindings settle together before taking a pose
  // snapshot. Never display a new-row/old-column intermediate pose.
  onFrameRowChanged: Qt.callLater(updatePose)
  onFrameColChanged: Qt.callLater(updatePose)
  onFrameOffsetYChanged: Qt.callLater(updatePose)
  Component.onCompleted: { ready = true; updatePose() }

  Behavior on stretch { NumberAnimation { duration: 280; easing.type: Easing.InOutSine } }
  SequentialAnimation on breath {
    running: root.active && root.breathing && !root.dragging
    loops: Animation.Infinite
    NumberAnimation { to: 1; duration: 1700; easing.type: Easing.InOutSine }
    NumberAnimation { to: 0; duration: 1700; easing.type: Easing.InOutSine }
  }
  // Tail-wag sway during emotes: slow lateral rock around the paws.
  SequentialAnimation on sway {
    running: root.active && root.emoteSway && !root.dragging
    loops: Animation.Infinite
    NumberAnimation { to: 1; duration: 520; easing.type: Easing.InOutSine }
    NumberAnimation { to: -1; duration: 1040; easing.type: Easing.InOutSine }
    NumberAnimation { to: 0; duration: 520; easing.type: Easing.InOutSine }
  }
  onEmoteSwayChanged: if (!emoteSway) sway = 0

  component AtlasCell: Item {
    property int row: 0
    property int frame: 0
    clip: true
    Image {
      x: -parent.frame * root.width
      y: -parent.row * root.height
      width: root.columns * root.width
      height: root.rowCount * root.height
      source: root.source
      sourceSize: Qt.size(root.columns * root.cellWidth, root.rowCount * root.cellHeight)
      smooth: true
      cache: true
    }
  }

  Item {
    anchors.fill: parent
    transform: [
      Rotation {
        origin.x: root.width / 2
        origin.y: root.height * (root.cellHeight - 5) / root.cellHeight
        angle: root.walking ? 0 : root.tiltDeg + (root.emoteSway ? root.sway * 2.5 : 0)
      },
      Scale {
        origin.x: root.width / 2
        origin.y: root.height * (root.cellHeight - 5) / root.cellHeight
        xScale: (root.facing >= 0 ? 1 : -1) * (1 + root.squash - root.stretch / 2)
        yScale: 1 - root.squash + root.stretch + (root.breathing ? root.breath * 0.008 : 0)
      }
    ]
    AtlasCell {
      width: root.width
      height: root.height
      y: root.currentOffset * root.height / root.cellHeight
      row: Math.max(0, root.currentRow)
      frame: root.currentFrame
    }
  }
}
