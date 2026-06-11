// Robust handedness detection via multi-signal fusion.
//
// Surveying 8 open-source serve/swing/pitch analyzers turned up that every
// shipping system uses a user-supplied left/right flag, not auto-detection;
// the only auto-detector with reported high accuracy (PitcherNet) is closed
// source. So we run 5 independent signals over the smoothed pose sequence,
// confidence-gate each one, convert each to log-odds, and aggregate.
//
// Signals (and their weights, calibrated from the research findings):
//   peak wrist linear speed    — weight 3   (serving arm whips faster than anything else)
//   wrist x-range during swing — weight 2   (serving wrist travels much further horizontally)
//   trophy-pose elbow flexion  — weight 1.5 (serving arm bent ~90°, tossing arm extended ~170°)
//   follow-through cross-body  — weight 1.5 (serving wrist ends near opposite hip)
//   peak wrist Y               — weight 1   (the old single-signal method, demoted to tiebreaker)
//
// Returns: { hand: 'right' | 'left', confidence: number, signals: {...} }
// `confidence` is in [0, 1]; the UI shows a manual prompt below 0.3.

// MoveNet 17-keypoint COCO indices.
const LEFT_SHOULDER = 5
const RIGHT_SHOULDER = 6
const LEFT_ELBOW = 7
const RIGHT_ELBOW = 8
const LEFT_WRIST = 9
const RIGHT_WRIST = 10
const LEFT_HIP = 11
const RIGHT_HIP = 12

const KP_MIN_SCORE = 0.3

function pt(pose, idx) {
  if (!pose || !pose.keypoints) return null
  const k = pose.keypoints[idx]
  return k && k.score >= KP_MIN_SCORE ? k : null
}

function dist2D(a, b) {
  if (!a || !b) return null
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function jointAngle(a, vertex, c) {
  if (!a || !vertex || !c) return null
  const v1x = a.x - vertex.x, v1y = a.y - vertex.y
  const v2x = c.x - vertex.x, v2y = c.y - vertex.y
  const dot = v1x * v2x + v1y * v2y
  const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)
  if (mag === 0) return null
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * (180 / Math.PI)
}

// Frame-by-frame peak wrist speed (px/s in 2D image coords). The serving arm
// has a dramatic velocity peak at racket contact; the tossing arm peaks gently
// during the throw and is much slower.
function peakWristSpeed(poses, frames, wristIdx) {
  let peak = 0
  for (let i = 1; i < poses.length; i++) {
    const a = pt(poses[i - 1], wristIdx)
    const b = pt(poses[i], wristIdx)
    if (!a || !b) continue
    const dt = frames[i].timestamp - frames[i - 1].timestamp
    if (dt <= 0) continue
    const v = dist2D(a, b) / dt
    if (v > peak) peak = v
  }
  return peak
}

// Total horizontal travel of the wrist across the clip. Serving wrist travels
// far more in x (backswing → contact → follow-through across the body).
function wristXRange(poses, wristIdx) {
  let minX = Infinity, maxX = -Infinity
  for (const pose of poses) {
    const k = pt(pose, wristIdx)
    if (!k) continue
    if (k.x < minX) minX = k.x
    if (k.x > maxX) maxX = k.x
  }
  if (minX === Infinity) return 0
  return maxX - minX
}

// Find the trophy-position frame (peak wrist Y for each side) and report
// elbow flexion at that moment. The serving arm is bent (~90°), tossing arm
// extended (~170°+). LOWER angle = MORE bent = more like serving arm, so we
// return a value where smaller = serving evidence.
function trophyElbowAngle(poses, side) {
  const wristIdx = side === 'right' ? RIGHT_WRIST : LEFT_WRIST
  const elbowIdx = side === 'right' ? RIGHT_ELBOW : LEFT_ELBOW
  const shoulderIdx = side === 'right' ? RIGHT_SHOULDER : LEFT_SHOULDER

  let bestFrame = null
  let highestY = Infinity
  for (const pose of poses) {
    const w = pt(pose, wristIdx)
    if (!w) continue
    if (w.y < highestY) {
      highestY = w.y
      bestFrame = pose
    }
  }
  if (!bestFrame) return null
  const sh = pt(bestFrame, shoulderIdx)
  const el = pt(bestFrame, elbowIdx)
  const wr = pt(bestFrame, wristIdx)
  return jointAngle(sh, el, wr)
}

// Distance of the wrist at the LAST detected frame from the opposite hip.
// Serving wrist ends near the opposite hip (cross-body follow-through);
// tossing wrist stays put. SMALLER distance = MORE serving evidence.
function followThroughCrossBody(poses, side) {
  const wristIdx = side === 'right' ? RIGHT_WRIST : LEFT_WRIST
  const oppHipIdx = side === 'right' ? LEFT_HIP : RIGHT_HIP
  for (let i = poses.length - 1; i >= 0; i--) {
    const wr = pt(poses[i], wristIdx)
    const hp = pt(poses[i], oppHipIdx)
    if (wr && hp) return dist2D(wr, hp)
  }
  return null
}

// Peak wrist Y (lowest y value = highest in image). Higher peak = more
// serving evidence.
function peakWristY(poses, wristIdx) {
  let minY = Infinity
  for (const pose of poses) {
    const k = pt(pose, wristIdx)
    if (!k) continue
    if (k.y < minY) minY = k.y
  }
  return minY === Infinity ? null : minY
}

// Convert a paired signal (rightValue, leftValue) into a signed log-odds vote
// in favor of "right is serving". `polarity` is +1 when larger right value
// means "right is serving" (e.g. speed, x-range, peak height-inverse), -1 when
// smaller right value means "right is serving" (e.g. elbow angle bent,
// cross-body distance smaller).
function vote(rightVal, leftVal, weight, polarity) {
  if (rightVal == null || leftVal == null) return 0
  const eps = 1e-3
  const ratio = polarity > 0
    ? (rightVal + eps) / (leftVal + eps)
    : (leftVal + eps) / (rightVal + eps)
  // log ratio is symmetric and bounded; clamp to avoid one massive outlier
  // swamping the rest of the fusion.
  const logRatio = Math.max(-3, Math.min(3, Math.log(ratio)))
  return weight * logRatio
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x))
}

export function detectHandedness(poses, frames) {
  if (!poses || poses.length < 2) {
    return { hand: 'right', confidence: 0, signals: {}, reason: 'not enough frames' }
  }

  // --- Compute paired signals (right vs left) ---
  // Sign convention: each `*Vote` is the signed log-odds favoring "right is serving".

  const speedR = peakWristSpeed(poses, frames, RIGHT_WRIST)
  const speedL = peakWristSpeed(poses, frames, LEFT_WRIST)
  const speedVote = vote(speedR, speedL, 3.0, +1)

  const xR = wristXRange(poses, RIGHT_WRIST)
  const xL = wristXRange(poses, LEFT_WRIST)
  const xRangeVote = vote(xR, xL, 2.0, +1)

  const elbowR = trophyElbowAngle(poses, 'right')
  const elbowL = trophyElbowAngle(poses, 'left')
  // Smaller elbow angle (more bent) on a side = serving evidence for that side.
  const elbowVote = vote(elbowR, elbowL, 1.5, -1)

  const ftR = followThroughCrossBody(poses, 'right')
  const ftL = followThroughCrossBody(poses, 'left')
  // Smaller cross-body distance on a side = serving evidence for that side.
  const ftVote = vote(ftR, ftL, 1.5, -1)

  // peakWristY: smaller y = higher in image = more serving evidence. Invert
  // by negating into a "height" value before voting.
  const yR = peakWristY(poses, RIGHT_WRIST)
  const yL = peakWristY(poses, LEFT_WRIST)
  // Convert "lowest y" to "height above bottom" so larger = more serving;
  // a constant offset matters for the log ratio so use a reasonable image
  // baseline (1000 px) — final result is rank-preserving.
  const heightR = yR == null ? null : 1000 - yR
  const heightL = yL == null ? null : 1000 - yL
  const yVote = vote(heightR, heightL, 1.0, +1)

  const totalLogOdds = speedVote + xRangeVote + elbowVote + ftVote + yVote
  const probRight = sigmoid(totalLogOdds)
  const confidence = Math.abs(probRight - 0.5) * 2

  return {
    hand: probRight >= 0.5 ? 'right' : 'left',
    confidence,
    signals: {
      speed:   { right: speedR,   left: speedL,   vote: speedVote   },
      xRange:  { right: xR,       left: xL,       vote: xRangeVote  },
      elbow:   { right: elbowR,   left: elbowL,   vote: elbowVote   },
      followT: { right: ftR,      left: ftL,      vote: ftVote      },
      peakY:   { right: yR,       left: yL,       vote: yVote       },
    },
    totalLogOdds,
    probRight,
  }
}
