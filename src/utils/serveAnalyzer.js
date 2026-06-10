// MoveNet 17-keypoint COCO indices.
const KP = {
  NOSE: 0,
  LEFT_SHOULDER: 5,  RIGHT_SHOULDER: 6,
  LEFT_ELBOW: 7,     RIGHT_ELBOW: 8,
  LEFT_WRIST: 9,     RIGHT_WRIST: 10,
  LEFT_HIP: 11,      RIGHT_HIP: 12,
  LEFT_KNEE: 13,     RIGHT_KNEE: 14,
  LEFT_ANKLE: 15,    RIGHT_ANKLE: 16,
}

// MoveNet scores: 0.3 is a safe visibility gate (higher would drop too many joints).
const MIN_CONFIDENCE = 0.3

function kp(pose, idx) {
  if (!pose || !pose.keypoints) return null
  const p = pose.keypoints[idx]
  return p && p.score > MIN_CONFIDENCE ? p : null
}

function dist2D(a, b) {
  if (!a || !b) return null
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// Interior angle (degrees) at `vertex` formed by a–vertex–c (2D).
function jointAngle(a, vertex, c) {
  if (!a || !vertex || !c) return null
  const v1x = a.x - vertex.x, v1y = a.y - vertex.y
  const v2x = c.x - vertex.x, v2y = c.y - vertex.y
  const dot = v1x * v2x + v1y * v2y
  const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)
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
// Per-phase scoring
// ----------------------------------------------------------------------------

function analyzeStance(pose, handedness) {
  if (!pose) return uncertain('Stance', 'Could not pick a stable stance frame — try a video where you set up clearly before the toss')

  const lAnkle = kp(pose, KP.LEFT_ANKLE)
  const rAnkle = kp(pose, KP.RIGHT_ANKLE)
  const lShoulder = kp(pose, KP.LEFT_SHOULDER)
  const rShoulder = kp(pose, KP.RIGHT_SHOULDER)
  const lHip = kp(pose, KP.LEFT_HIP)
  const rHip = kp(pose, KP.RIGHT_HIP)

  if (!lAnkle || !rAnkle) {
    return uncertain('Stance', 'Could not detect both feet — keep your full body in frame')
  }

  // Normalize by torso height (shoulder midpoint Y to hip midpoint Y) which is
  // stable across camera distances and viewing angles.
  let normRef = null
  if (lShoulder && rShoulder && lHip && rHip) {
    const shoulderMidY = (lShoulder.y + rShoulder.y) / 2
    const hipMidY = (lHip.y + rHip.y) / 2
    normRef = Math.abs(hipMidY - shoulderMidY)
  } else if (lShoulder && rShoulder) {
    // Fallback: use shoulder width as a rough body reference.
    normRef = dist2D(lShoulder, rShoulder)
  }

  if (!normRef || normRef < 5) {
    return uncertain('Stance', 'Could not establish a body reference — try a clearer, well-lit recording')
  }

  const feetSep = dist2D(lAnkle, rAnkle)
  const ratio = feetSep / normRef
  const pct = Math.round(ratio * 100)

  // A torso-length ratio of 0.4–0.9 corresponds roughly to shoulder-width stance.
  if (ratio >= 0.4 && ratio <= 0.9) {
    return { name: 'Stance', score: 88, status: 'good', feedback: [`Good stance width — feet are well positioned for a stable base`] }
  } else if (ratio < 0.4) {
    return { name: 'Stance', score: 52, status: 'poor', feedback: [`Feet appear close together — widen your stance to about shoulder width for better balance and power transfer`] }
  } else {
    return { name: 'Stance', score: 65, status: 'needs_work', feedback: [`Stance is slightly wide — a shoulder-width stance gives the best stability`] }
  }
}

function analyzeBallToss(pose, handedness) {
  if (!pose) return uncertain('Ball Toss', 'Could not pinpoint the ball-toss release frame in this clip')

  const tossWristIdx = handedness === 'right' ? KP.LEFT_WRIST : KP.RIGHT_WRIST
  const tossShoulderIdx = handedness === 'right' ? KP.LEFT_SHOULDER : KP.RIGHT_SHOULDER

  const wrist = kp(pose, tossWristIdx)
  const shoulder = kp(pose, tossShoulderIdx)
  const nose = kp(pose, KP.NOSE)

  if (!wrist) return uncertain('Ball Toss', 'Could not detect the tossing hand — keep your whole body visible throughout the serve')

  if (nose) {
    if (wrist.y < nose.y - 10) {
      const extended = shoulder && wrist.y < shoulder.y - 40
      return {
        name: 'Ball Toss',
        score: extended ? 92 : 82,
        status: 'good',
        feedback: [extended
          ? 'Excellent ball toss — arm fully extended above head height for a clean release'
          : 'Good toss height — wrist is above head level'],
      }
    } else if (wrist.y < nose.y + 20) {
      return { name: 'Ball Toss', score: 65, status: 'needs_work', feedback: ['Toss height is borderline — aim to release with your arm fully extended above your head for more control'] }
    }
    return { name: 'Ball Toss', score: 42, status: 'poor', feedback: ['Toss appears low — extend your arm completely and release the ball at the peak of your reach'] }
  }

  if (shoulder) {
    if (wrist.y < shoulder.y - 30) {
      return { name: 'Ball Toss', score: 80, status: 'good', feedback: ['Good toss height — tossing arm is well raised above the shoulder'] }
    } else if (wrist.y < shoulder.y) {
      return { name: 'Ball Toss', score: 62, status: 'needs_work', feedback: ['Tossing arm only slightly raised — extend it fully above your head for a higher, more controlled toss'] }
    }
    return { name: 'Ball Toss', score: 45, status: 'poor', feedback: ['Tossing arm appears low — reach up and release the ball at full extension above your head'] }
  }

  return uncertain('Ball Toss', 'Could not find a head or shoulder reference — try a clearer, well-lit recording')
}

function analyzeTrophyPosition(pose, handedness) {
  if (!pose) return uncertain('Trophy Position', 'Could not pinpoint the trophy frame in this clip')

  const isRight = handedness === 'right'
  const elbow = kp(pose, isRight ? KP.RIGHT_ELBOW : KP.LEFT_ELBOW)
  const shoulder = kp(pose, isRight ? KP.RIGHT_SHOULDER : KP.LEFT_SHOULDER)
  const knee = kp(pose, isRight ? KP.RIGHT_KNEE : KP.LEFT_KNEE)
  const hip = kp(pose, isRight ? KP.RIGHT_HIP : KP.LEFT_HIP)
  const ankle = kp(pose, isRight ? KP.RIGHT_ANKLE : KP.LEFT_ANKLE)

  if (!elbow || !shoulder) {
    return uncertain('Trophy Position', 'Could not detect the serving arm in the trophy frame')
  }

  const feedback = []
  let score = 70

  // Elbow above shoulder = classic trophy shape (smaller y = higher in image).
  if (elbow.y < shoulder.y) {
    score += 15
    feedback.push('Good racket arm position — elbow is above shoulder level, creating the classic trophy shape')
  } else if (elbow.y < shoulder.y + 15) {
    feedback.push('Racket elbow is close to shoulder height — try to raise it slightly higher for a better trophy position')
  } else {
    score -= 15
    feedback.push('Racket elbow appears below shoulder level — raise your elbow to at least shoulder height to form the trophy position')
  }

  // Knee bend.
  const kneeAngle = jointAngle(hip, knee, ankle)
  if (kneeAngle !== null) {
    if (kneeAngle < 150) {
      score += 10
      feedback.push('Nice knee bend — leg drive will add significant power to your serve')
    } else if (kneeAngle < 165) {
      feedback.push('Some knee bend detected — try bending a bit more to maximize leg drive')
    } else {
      score -= 10
      feedback.push('Legs appear straight — bending your knees stores energy for an explosive upward push')
    }
  }

  score = clamp(score, 0, 100)
  return { name: 'Trophy Position', score, status: status(score), feedback }
}

function analyzeContact(pose, handedness) {
  if (!pose) return uncertain('Contact Point', 'Could not pinpoint the contact frame in this clip')

  const isRight = handedness === 'right'
  const wrist = kp(pose, isRight ? KP.RIGHT_WRIST : KP.LEFT_WRIST)
  const elbow = kp(pose, isRight ? KP.RIGHT_ELBOW : KP.LEFT_ELBOW)
  const shoulder = kp(pose, isRight ? KP.RIGHT_SHOULDER : KP.LEFT_SHOULDER)
  const nose = kp(pose, KP.NOSE)

  if (!wrist) return uncertain('Contact Point', 'Could not detect the racket hand at the contact frame')

  const feedback = []
  let score = 65

  if (nose) {
    if (wrist.y < nose.y - 10) {
      score += 18
      feedback.push('Good contact height — racket is making contact above head level')
    } else if (wrist.y < nose.y + 20) {
      feedback.push('Contact height is near head level — aim to reach higher for more power and a better angle over the net')
    } else {
      score -= 15
      feedback.push('Contact point appears low — reach up to strike the ball above your head for maximum power')
    }
  } else {
    feedback.push('Could not find a head reference to judge contact height — scored on arm extension only')
  }

  const angle = jointAngle(shoulder, elbow, wrist)
  if (angle !== null) {
    if (angle > 155) {
      score += 15
      feedback.push(`Arm well extended at contact (${Math.round(angle)}°) — excellent reach`)
    } else if (angle > 130) {
      score += 5
      feedback.push(`Arm moderately extended at contact (${Math.round(angle)}°) — try to straighten a bit more`)
    } else {
      score -= 10
      feedback.push(`Arm appears bent at contact (${Math.round(angle)}°) — fully extend toward the ball for more power`)
    }
  }

  score = clamp(score, 0, 100)
  return { name: 'Contact Point', score, status: status(score), feedback }
}

function analyzeFollowThrough(pose, handedness) {
  if (!pose) return uncertain('Follow-Through', 'Could not pinpoint the follow-through frame in this clip')

  const isRight = handedness === 'right'
  const wrist = kp(pose, isRight ? KP.RIGHT_WRIST : KP.LEFT_WRIST)
  const hip = kp(pose, isRight ? KP.RIGHT_HIP : KP.LEFT_HIP)
  const oppHip = kp(pose, isRight ? KP.LEFT_HIP : KP.RIGHT_HIP)

  if (!wrist) return uncertain('Follow-Through', 'Could not detect the follow-through position clearly')

  if (hip && oppHip) {
    const midX = (hip.x + oppHip.x) / 2
    const hipWidth = Math.abs(hip.x - oppHip.x) || 1
    const crossed = isRight ? wrist.x < midX : wrist.x > midX
    const distFromMid = Math.abs(wrist.x - midX)

    if (crossed) {
      return { name: 'Follow-Through', score: 90, status: 'good', feedback: ['Complete follow-through — racket arm has crossed the body correctly, promoting spin and control'] }
    } else if (distFromMid < hipWidth * 0.5) {
      return { name: 'Follow-Through', score: 68, status: 'needs_work', feedback: ['Follow-through almost complete — let the racket continue swinging fully across your body'] }
    }
    return { name: 'Follow-Through', score: 48, status: 'poor', feedback: ['Incomplete follow-through — allow the racket to swing naturally all the way across your body. Stopping early reduces spin and increases injury risk'] }
  }

  return { name: 'Follow-Through', score: 65, status: 'needs_work', feedback: ['Follow-through detected — ensure the racket swings completely across your body toward the opposite hip'] }
}

// ----------------------------------------------------------------------------
// Composite scoring: 40% angles, 30% tempo, 30% penalties.
// ----------------------------------------------------------------------------

function tempoScore(elapsed, idealMin, idealMax, falloff) {
  if (elapsed == null) return null
  if (elapsed >= idealMin && elapsed <= idealMax) return 100
  const dist = elapsed < idealMin ? idealMin - elapsed : elapsed - idealMax
  const k = dist / falloff
  return clamp(Math.round(100 * Math.exp(-k * k)), 0, 100)
}

function computeTempo(phases) {
  const ts = phases.map(p => p.frame ? p.frame.timestamp : null)
  const tossToTrophy = ts[1] != null && ts[2] != null ? ts[2] - ts[1] : null
  const trophyToContact = ts[2] != null && ts[3] != null ? ts[3] - ts[2] : null
  const contactToFollow = ts[3] != null && ts[4] != null ? ts[4] - ts[3] : null

  const s1 = tempoScore(tossToTrophy, 0.4, 0.7, 0.3)
  const s2 = tempoScore(trophyToContact, 0.15, 0.3, 0.15)
  const s3 = tempoScore(contactToFollow, 0.15, 0.3, 0.15)

  const parts = [s1, s2, s3].filter(s => s != null)
  if (parts.length === 0) return { score: 70, breakdown: { tossToTrophy, trophyToContact, contactToFollow } }
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length
  return { score: Math.round(avg), breakdown: { tossToTrophy, trophyToContact, contactToFollow } }
}

function computeAngles(phaseResults) {
  const indices = [1, 2, 3] // toss, trophy, contact
  const scores = indices.map(i => phaseResults[i].score)
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  return Math.round(avg)
}

function computePenalties(phaseResults) {
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
