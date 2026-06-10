// Dynamic phase detection from a smoothed pose sequence.
// Picks the 5 most informative frames for scoring: Stance, Ball Toss release,
// Trophy Position, Contact Point, Follow-Through. Pattern lifted from
// `ryanboscobanze/GolfPosePro` (wrist-Y trajectory) extended with serve-
// specific signals.

// BlazePose landmark indices
const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12
const LEFT_ELBOW = 13
const RIGHT_ELBOW = 14
const LEFT_WRIST = 15
const RIGHT_WRIST = 16
const LEFT_HIP = 23
const RIGHT_HIP = 24
const LEFT_KNEE = 25
const RIGHT_KNEE = 26
const LEFT_ANKLE = 27
const RIGHT_ANKLE = 28

const KP_MIN_SCORE = 0.5

function pt(pose, idx) {
  if (!pose || !pose.keypoints) return null
  const k = pose.keypoints[idx]
  return k && k.score >= KP_MIN_SCORE ? k : null
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

function speed2D(a, b, dt) {
  if (!a || !b || dt <= 0) return 0
  return Math.hypot(a.x - b.x, a.y - b.y) / dt
}

// Return [contact-relative motion-energy curve, contact index].
// Contact = frame with peak serving-wrist speed (the racket whip-through).
function findContactFrame(poses, frames, servingWristIdx) {
  let contactIdx = -1
  let peakSpeed = 0
  for (let i = 1; i < poses.length; i++) {
    const a = pt(poses[i - 1], servingWristIdx)
    const b = pt(poses[i], servingWristIdx)
    if (!a || !b) continue
    const dt = frames[i].timestamp - frames[i - 1].timestamp
    const v = speed2D(a, b, dt)
    if (v > peakSpeed) {
      peakSpeed = v
      contactIdx = i
    }
  }
  return { contactIdx, peakSpeed }
}

// Trophy = frame BEFORE contact where serving wrist is highest behind the head.
// Search backwards from contact for the local maximum of y-inverted position.
function findTrophyFrame(poses, servingWristIdx, contactIdx) {
  if (contactIdx < 1) return -1
  let trophyIdx = -1
  let highestY = Infinity
  for (let i = 0; i < contactIdx; i++) {
    const w = pt(poses[i], servingWristIdx)
    if (!w) continue
    if (w.y < highestY) {
      highestY = w.y
      trophyIdx = i
    }
  }
  return trophyIdx
}

// Ball toss release = frame BEFORE trophy where the tossing wrist FIRST starts
// moving upward strongly (i.e. ball leaves the hand). Find the frame where
// tossing-wrist upward velocity peaks within the pre-trophy window.
function findBallTossFrame(poses, frames, tossWristIdx, trophyIdx) {
  if (trophyIdx < 1) return 0
  let bestIdx = 0
  let peakUpwardV = 0
  for (let i = 1; i <= trophyIdx; i++) {
    const a = pt(poses[i - 1], tossWristIdx)
    const b = pt(poses[i], tossWristIdx)
    if (!a || !b) continue
    const dt = frames[i].timestamp - frames[i - 1].timestamp
    if (dt <= 0) continue
    // y decreases as wrist goes up — upward velocity is -(b.y - a.y)/dt.
    const upV = (a.y - b.y) / dt
    if (upV > peakUpwardV) {
      peakUpwardV = upV
      bestIdx = i
    }
  }
  return bestIdx
}

// Stance = earliest frame where both ankles are detected and ankle motion is
// minimal — the player has set up but hasn't started moving yet. Falls back
// to frame 0 if motion never settles.
function findStanceFrame(poses, frames) {
  const window = 3
  let bestIdx = 0
  let lowestEnergy = Infinity
  for (let i = window; i < poses.length / 3; i++) { // only look at first third
    let energy = 0
    let samples = 0
    for (let k = i - window; k < i; k++) {
      const lA = pt(poses[k], LEFT_ANKLE), lB = pt(poses[k + 1], LEFT_ANKLE)
      const rA = pt(poses[k], RIGHT_ANKLE), rB = pt(poses[k + 1], RIGHT_ANKLE)
      const dt = frames[k + 1].timestamp - frames[k].timestamp
      if (lA && lB && dt > 0) { energy += speed2D(lA, lB, dt); samples++ }
      if (rA && rB && dt > 0) { energy += speed2D(rA, rB, dt); samples++ }
    }
    if (samples === 0) continue
    energy /= samples
    if (energy < lowestEnergy) {
      lowestEnergy = energy
      bestIdx = i
    }
  }
  return bestIdx
}

// Follow-through = a few frames after contact, when the racket arm has fully
// swung across the body. ~200ms after contact is biomechanically typical.
function findFollowThroughFrame(poses, frames, contactIdx) {
  if (contactIdx < 0) return poses.length - 1
  const targetT = frames[contactIdx].timestamp + 0.2
  let bestIdx = poses.length - 1
  let bestDiff = Infinity
  for (let i = contactIdx + 1; i < poses.length; i++) {
    const diff = Math.abs(frames[i].timestamp - targetT)
    if (diff < bestDiff) {
      bestDiff = diff
      bestIdx = i
    }
  }
  return bestIdx
}

// Given a smoothed pose sequence + corresponding frame metadata + handedness,
// return the 5 phase frames as { name, index, pose, frame } objects in serve
// order: stance, ball toss, trophy, contact, follow-through.
//
// If detection fails for one of the phases (e.g. clip too short, all
// keypoints occluded), the corresponding entry has pose: null so the
// downstream analyzer can flag it as uncertain.
export function detectPhases(poses, frames, handedness) {
  if (!poses || poses.length < 3) {
    return [
      { name: 'Stance',          index: -1, pose: null, frame: null },
      { name: 'Ball Toss',       index: -1, pose: null, frame: null },
      { name: 'Trophy Position', index: -1, pose: null, frame: null },
      { name: 'Contact Point',   index: -1, pose: null, frame: null },
      { name: 'Follow-Through',  index: -1, pose: null, frame: null },
    ]
  }

  const servingWrist = handedness === 'right' ? RIGHT_WRIST : LEFT_WRIST
  const tossingWrist = handedness === 'right' ? LEFT_WRIST : RIGHT_WRIST

  const stanceIdx = findStanceFrame(poses, frames)
  const { contactIdx } = findContactFrame(poses, frames, servingWrist)
  const trophyIdx = findTrophyFrame(poses, servingWrist, contactIdx)
  const tossIdx = findBallTossFrame(poses, frames, tossingWrist, trophyIdx)
  const followIdx = findFollowThroughFrame(poses, frames, contactIdx)

  const pickFrame = (idx) => idx >= 0 ? {
    pose: poses[idx], frame: frames[idx], index: idx,
  } : { pose: null, frame: null, index: -1 }

  return [
    { name: 'Stance',          ...pickFrame(stanceIdx)  },
    { name: 'Ball Toss',       ...pickFrame(tossIdx)    },
    { name: 'Trophy Position', ...pickFrame(trophyIdx)  },
    { name: 'Contact Point',   ...pickFrame(contactIdx) },
    { name: 'Follow-Through',  ...pickFrame(followIdx)  },
  ]
}
