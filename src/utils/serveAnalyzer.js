// BlazePose 33-landmark indices (subset used here).
const KP = {
  NOSE: 0,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
}

// BlazePose visibility scores tend to be high (>0.8) for clearly visible
// joints; 0.5 gates out fully occluded ones without being so strict it
// discards usable signal.
const MIN_CONFIDENCE = 0.5

// ----------------------------------------------------------------------------
// Keypoint accessors
// ----------------------------------------------------------------------------

// 2D image-space keypoint (px). Returns null when occluded or off-frame.
function kp2D(pose, idx) {
  if (!pose || !pose.keypoints) return null
  const p = pose.keypoints[idx]
  return p && p.score > MIN_CONFIDENCE ? p : null
}

// 3D hip-centered world-space keypoint (meters). BlazePose centers the
// coordinate system at the midpoint of the hips, so x/y/z are body-relative
// and camera-angle independent. Returns null when not detected.
function kp3D(pose, idx) {
  if (!pose || !pose.keypoints3D) return null
  const p = pose.keypoints3D[idx]
  if (!p) return null
  // BlazePose 3D keypoints don't always carry a meaningful score; trust the
  // matching 2D keypoint's score as the visibility proxy.
  const score = (pose.keypoints && pose.keypoints[idx] && pose.keypoints[idx].score) || 0
  return score > MIN_CONFIDENCE ? p : null
}

function dist3D(a, b) {
  if (!a || !b) return null
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function dist2D(a, b) {
  if (!a || !b) return null
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// Interior angle (degrees) at `vertex` formed by points a–vertex–c. Works in
// 2D or 3D — we always pass 3D where possible since projection foreshortening
// can collapse a real joint angle.
function jointAngle3D(a, vertex, c) {
  if (!a || !vertex || !c) return null
  const v1x = a.x - vertex.x, v1y = a.y - vertex.y, v1z = (a.z ?? 0) - (vertex.z ?? 0)
  const v2x = c.x - vertex.x, v2y = c.y - vertex.y, v2z = (c.z ?? 0) - (vertex.z ?? 0)
  const dot = v1x * v2x + v1y * v2y + v1z * v2z
  const mag = Math.hypot(v1x, v1y, v1z) * Math.hypot(v2x, v2y, v2z)
  if (mag === 0) return null
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * (180 / Math.PI)
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

function status(score) {
  if (score >= 78) return 'good'
  if (score >= 55) return 'needs_work'
  return 'poor'
}

function uncertain(name, message) {
  return { name, score: 60, status: 'uncertain', feedback: [message] }
}

// ----------------------------------------------------------------------------
// Per-phase scoring — each phase receives the SINGLE pose at its chosen frame.
// Returns { name, score, status, feedback } same shape as before so the UI
// keeps working unchanged.
// ----------------------------------------------------------------------------

function analyzeStance(pose, handedness) {
  if (!pose) return uncertain('Stance', 'Could not pick a stable stance frame — try a video where you set up clearly before the toss')

  // Use 3D world coords for camera-invariant stance width measurement.
  const lAnkle3 = kp3D(pose, KP.LEFT_ANKLE)
  const rAnkle3 = kp3D(pose, KP.RIGHT_ANKLE)
  const lShoulder3 = kp3D(pose, KP.LEFT_SHOULDER)
  const rShoulder3 = kp3D(pose, KP.RIGHT_SHOULDER)

  if (!lAnkle3 || !rAnkle3 || !lShoulder3 || !rShoulder3) {
    return uncertain('Stance', 'Could not clearly detect both feet and shoulders — keep your full body in frame')
  }

  // 3D Euclidean distance in meters. Stance width is camera-angle independent.
  const feetWidth = dist3D(lAnkle3, rAnkle3)
  const shoulderWidth = dist3D(lShoulder3, rShoulder3)

  if (!feetWidth || !shoulderWidth || shoulderWidth < 0.05) {
    return uncertain('Stance', 'Could not measure stance reliably — try a clearer recording')
  }

  const ratio = feetWidth / shoulderWidth
  const pct = Math.round(ratio * 100)

  if (ratio >= 0.8 && ratio <= 1.4) {
    return { name: 'Stance', score: 88, status: 'good', feedback: [`Good stance — feet are ${pct}% of shoulder width, providing a stable base`] }
  } else if (ratio < 0.8) {
    return { name: 'Stance', score: 52, status: 'poor', feedback: [`Feet appear close together (${pct}% of shoulder width) — widen your stance to shoulder width for better balance and power transfer`] }
  } else {
    return { name: 'Stance', score: 65, status: 'needs_work', feedback: [`Stance is slightly wide (${pct}% of shoulder width) — a shoulder-width stance gives the best stability`] }
  }
}

function analyzeBallToss(pose, handedness) {
  if (!pose) return uncertain('Ball Toss', 'Could not pinpoint the ball-toss release frame in this clip')

  const tossWristIdx = handedness === 'right' ? KP.LEFT_WRIST : KP.RIGHT_WRIST
  const tossShoulderIdx = handedness === 'right' ? KP.LEFT_SHOULDER : KP.RIGHT_SHOULDER

  const wrist3 = kp3D(pose, tossWristIdx)
  const shoulder3 = kp3D(pose, tossShoulderIdx)
  const nose3 = kp3D(pose, KP.NOSE)

  if (!wrist3) return uncertain('Ball Toss', 'Could not detect the tossing hand — keep your whole body visible throughout the serve')

  // In BlazePose 3D coords, y INCREASES downward like image space. Smaller y = higher up.
  if (nose3) {
    // ~5 cm above the nose is a clean release; ~50 cm = fully extended.
    if (wrist3.y < nose3.y - 0.05) {
      const extended = shoulder3 && wrist3.y < shoulder3.y - 0.5
      return {
        name: 'Ball Toss',
        score: extended ? 92 : 82,
        status: 'good',
        feedback: [extended
          ? 'Excellent ball toss — arm fully extended above head height for a clean release'
          : 'Good toss height — wrist is above head level'],
      }
    } else if (wrist3.y < nose3.y + 0.2) {
      return { name: 'Ball Toss', score: 65, status: 'needs_work', feedback: ['Toss height is borderline — aim to release with your arm fully extended above your head for more control'] }
    }
    return { name: 'Ball Toss', score: 42, status: 'poor', feedback: ['Toss appears low — extend your arm completely and release the ball at the peak of your reach to give yourself time to prepare'] }
  }

  if (shoulder3) {
    if (wrist3.y < shoulder3.y - 0.3) {
      return { name: 'Ball Toss', score: 80, status: 'good', feedback: ['Good toss height — tossing arm is well raised above the shoulder'] }
    } else if (wrist3.y < shoulder3.y) {
      return { name: 'Ball Toss', score: 62, status: 'needs_work', feedback: ['Tossing arm is only slightly raised — extend it fully above your head for a higher, more controlled toss'] }
    }
    return { name: 'Ball Toss', score: 45, status: 'poor', feedback: ['Tossing arm appears low — reach up and release the ball at full extension above your head'] }
  }

  return uncertain('Ball Toss', 'Could not find a head or shoulder reference to judge toss height — try a clearer, well-lit recording')
}

function analyzeTrophyPosition(pose, handedness) {
  if (!pose) return uncertain('Trophy Position', 'Could not pinpoint the trophy frame in this clip')

  const isRight = handedness === 'right'
  const elbow3 = kp3D(pose, isRight ? KP.RIGHT_ELBOW : KP.LEFT_ELBOW)
  const shoulder3 = kp3D(pose, isRight ? KP.RIGHT_SHOULDER : KP.LEFT_SHOULDER)
  const knee3 = kp3D(pose, isRight ? KP.RIGHT_KNEE : KP.LEFT_KNEE)
  const hip3 = kp3D(pose, isRight ? KP.RIGHT_HIP : KP.LEFT_HIP)
  const ankle3 = kp3D(pose, isRight ? KP.RIGHT_ANKLE : KP.LEFT_ANKLE)

  if (!elbow3 || !shoulder3) {
    return uncertain('Trophy Position', 'Could not detect the serving arm in the trophy frame')
  }

  const feedback = []
  let score = 70

  // Racket elbow vs shoulder (smaller y = higher in space)
  if (elbow3.y < shoulder3.y) {
    score += 15
    feedback.push('Good racket arm position — elbow is above shoulder level, creating the classic trophy shape')
  } else if (elbow3.y < shoulder3.y + 0.1) {
    feedback.push('Racket elbow is close to shoulder height — try to raise it slightly higher for a better trophy position')
  } else {
    score -= 15
    feedback.push('Racket elbow appears below shoulder level — raise your elbow to at least shoulder height to form the trophy position')
  }

  // Knee bend (hip–knee–ankle angle; 180° = straight, ~150° = good bend)
  const kneeAngle = jointAngle3D(hip3, knee3, ankle3)
  if (kneeAngle !== null) {
    if (kneeAngle < 150) {
      score += 10
      feedback.push('Nice knee bend — leg drive will add significant power to your serve')
    } else if (kneeAngle < 165) {
      feedback.push('Some knee bend detected — try bending a bit more to maximize leg drive')
    } else {
      score -= 10
      feedback.push('Legs appear straight — bending your knees in the trophy position stores energy for an explosive upward push')
    }
  }

  score = clamp(score, 0, 100)
  return { name: 'Trophy Position', score, status: status(score), feedback }
}

function analyzeContact(pose, handedness) {
  if (!pose) return uncertain('Contact Point', 'Could not pinpoint the contact frame in this clip')

  const isRight = handedness === 'right'
  const wrist3 = kp3D(pose, isRight ? KP.RIGHT_WRIST : KP.LEFT_WRIST)
  const elbow3 = kp3D(pose, isRight ? KP.RIGHT_ELBOW : KP.LEFT_ELBOW)
  const shoulder3 = kp3D(pose, isRight ? KP.RIGHT_SHOULDER : KP.LEFT_SHOULDER)
  const nose3 = kp3D(pose, KP.NOSE)

  if (!wrist3) return uncertain('Contact Point', 'Could not detect the racket hand at the contact frame')

  const feedback = []
  let score = 65

  if (nose3) {
    if (wrist3.y < nose3.y - 0.05) {
      score += 18
      feedback.push('Good contact height — racket is making contact above head level')
    } else if (wrist3.y < nose3.y + 0.15) {
      feedback.push('Contact height is near head level — aim to reach higher for more power and a better angle over the net')
    } else {
      score -= 15
      feedback.push('Contact point appears low — reach up to strike the ball above your head for maximum power and clearance')
    }
  } else {
    feedback.push('Could not find a head reference to judge contact height — scored on arm extension only')
  }

  const angle = jointAngle3D(shoulder3, elbow3, wrist3)
  if (angle !== null) {
    if (angle > 155) {
      score += 15
      feedback.push(`Arm well extended at contact (${Math.round(angle)}°) — excellent reach`)
    } else if (angle > 130) {
      score += 5
      feedback.push(`Arm moderately extended at contact (${Math.round(angle)}°) — try to straighten a bit more for maximum reach`)
    } else {
      score -= 10
      feedback.push(`Arm appears bent at contact (${Math.round(angle)}°) — fully extend toward the ball to generate more power`)
    }
  }

  score = clamp(score, 0, 100)
  return { name: 'Contact Point', score, status: status(score), feedback }
}

function analyzeFollowThrough(pose, handedness) {
  if (!pose) return uncertain('Follow-Through', 'Could not pinpoint the follow-through frame in this clip')

  const isRight = handedness === 'right'
  // Cross-body proximity is most natural in 2D image space (it's about how far
  // across the BODY the racket has swung), so use 2D here.
  const wrist2 = kp2D(pose, isRight ? KP.RIGHT_WRIST : KP.LEFT_WRIST)
  const hip2 = kp2D(pose, isRight ? KP.RIGHT_HIP : KP.LEFT_HIP)
  const oppHip2 = kp2D(pose, isRight ? KP.LEFT_HIP : KP.RIGHT_HIP)

  if (!wrist2) return uncertain('Follow-Through', 'Could not detect the follow-through position clearly')

  if (hip2 && oppHip2) {
    const midX = (hip2.x + oppHip2.x) / 2
    const hipWidth = Math.abs(hip2.x - oppHip2.x) || 1
    const crossed = isRight ? wrist2.x < midX : wrist2.x > midX
    const distFromMid = Math.abs(wrist2.x - midX)

    if (crossed) {
      return { name: 'Follow-Through', score: 90, status: 'good', feedback: ['Complete follow-through — racket arm has crossed the body correctly, promoting spin and control'] }
    } else if (distFromMid < hipWidth * 0.5) {
      return { name: 'Follow-Through', score: 68, status: 'needs_work', feedback: ['Follow-through almost complete — let the racket continue swinging fully across your body to the opposite hip'] }
    }
    return { name: 'Follow-Through', score: 48, status: 'poor', feedback: ['Incomplete follow-through — allow the racket to swing naturally all the way across your body. Stopping early reduces spin and increases injury risk'] }
  }

  return { name: 'Follow-Through', score: 65, status: 'needs_work', feedback: ['Follow-through detected — ensure the racket swings completely across your body toward the opposite hip for maximum spin and safety'] }
}

// ----------------------------------------------------------------------------
// Composite scoring: 40% angles, 30% tempo, 30% penalties.
// Pattern from yakupzengin/fitness-trainer-pose-estimation (MIT).
// ----------------------------------------------------------------------------

// Score in [0, 100] from how well the elapsed time between two phases matches
// a target range. Inside the range scores 100; symmetric Gaussian-ish falloff
// outside.
function tempoScore(elapsed, idealMin, idealMax, falloff) {
  if (elapsed == null) return null
  if (elapsed >= idealMin && elapsed <= idealMax) return 100
  const dist = elapsed < idealMin ? idealMin - elapsed : elapsed - idealMax
  const k = dist / falloff
  return clamp(Math.round(100 * Math.exp(-k * k)), 0, 100)
}

function computeTempo(phases) {
  // Index into `phases` array: 0=stance, 1=toss, 2=trophy, 3=contact, 4=followT
  const ts = phases.map(p => p.frame ? p.frame.timestamp : null)
  const tossToTrophy = ts[1] != null && ts[2] != null ? ts[2] - ts[1] : null
  const trophyToContact = ts[2] != null && ts[3] != null ? ts[3] - ts[2] : null
  const contactToFollow = ts[3] != null && ts[4] != null ? ts[4] - ts[3] : null

  // Pro serve tempos (seconds, approximate biomechanical norms):
  //  - toss release → trophy: 0.4–0.7s
  //  - trophy → contact: 0.15–0.3s (the explosive whip)
  //  - contact → follow-through: 0.15–0.3s
  const s1 = tempoScore(tossToTrophy, 0.4, 0.7, 0.3)
  const s2 = tempoScore(trophyToContact, 0.15, 0.3, 0.15)
  const s3 = tempoScore(contactToFollow, 0.15, 0.3, 0.15)

  const parts = [s1, s2, s3].filter(s => s != null)
  if (parts.length === 0) return { score: 70, breakdown: { tossToTrophy, trophyToContact, contactToFollow } }
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length
  return {
    score: Math.round(avg),
    breakdown: { tossToTrophy, trophyToContact, contactToFollow },
  }
}

// Aggregate per-phase scores into the 3 buckets. We reuse the same per-phase
// rule outputs for the angles bucket and apply explicit penalty deductions.
function computeAngles(phaseResults) {
  // Angles bucket = average of trophy + contact + ball toss scores (the
  // phases that are most directly about joint angles / arm geometry).
  const indices = [1, 2, 3] // toss, trophy, contact
  const scores = indices.map(i => phaseResults[i].score)
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  return Math.round(avg)
}

function computePenalties(phaseResults) {
  // Start at 100, deduct for each known fault.
  let score = 100
  const reasons = []
  for (const phase of phaseResults) {
    if (phase.status === 'poor') {
      score -= 18
      reasons.push(`${phase.name} flagged as needs improvement`)
    } else if (phase.status === 'needs_work') {
      score -= 8
    } else if (phase.status === 'uncertain') {
      score -= 5
      reasons.push(`${phase.name} could not be measured`)
    }
  }
  return { score: clamp(score, 0, 100), reasons }
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

// Input: { phases, handedness, handednessConfidence }
//   phases: output of detectPhases — array of 5 { name, pose, frame, index }
//   handedness: 'right' | 'left'
//   handednessConfidence: number in [0,1] from handednessDetector (optional)
//
// Output: { overallScore, servingArm, phases, composite, handednessConfidence }
//   composite is the per-bucket breakdown; the UI can display it optionally.
export function analyzeServe({ phases, handedness, handednessConfidence }) {
  if (!phases || phases.length !== 5) {
    return {
      overallScore: 0,
      servingArm: handedness || 'right',
      warning: 'Phase detection failed — make sure your full body is visible throughout the serve',
      phases: [],
      composite: null,
      handednessConfidence: handednessConfidence ?? 0,
    }
  }

  if (phases.every(p => !p.pose)) {
    return {
      overallScore: 0,
      servingArm: handedness || 'right',
      warning: 'No body detected in any frame. Make sure your full body is clearly visible in the video.',
      phases: [],
      composite: null,
      handednessConfidence: handednessConfidence ?? 0,
    }
  }

  const hand = handedness || 'right'
  const phaseResults = [
    analyzeStance(phases[0].pose, hand),
    analyzeBallToss(phases[1].pose, hand),
    analyzeTrophyPosition(phases[2].pose, hand),
    analyzeContact(phases[3].pose, hand),
    analyzeFollowThrough(phases[4].pose, hand),
  ]

  const anglesScore = computeAngles(phaseResults)
  const { score: tempoBucketScore, breakdown: tempoBreakdown } = computeTempo(phases)
  const { score: penaltiesScore, reasons: penaltyReasons } = computePenalties(phaseResults)

  const overallScore = Math.round(0.4 * anglesScore + 0.3 * tempoBucketScore + 0.3 * penaltiesScore)

  return {
    overallScore,
    servingArm: hand,
    handednessConfidence: handednessConfidence ?? 1,
    phases: phaseResults,
    composite: {
      angles: anglesScore,
      tempo: tempoBucketScore,
      tempoBreakdown,
      penalties: penaltiesScore,
      penaltyReasons,
    },
  }
}
