// MoveNet keypoint indices
const KP = {
  NOSE: 0,
  LEFT_EYE: 1, RIGHT_EYE: 2,
  LEFT_EAR: 3, RIGHT_EAR: 4,
  LEFT_SHOULDER: 5, RIGHT_SHOULDER: 6,
  LEFT_ELBOW: 7, RIGHT_ELBOW: 8,
  LEFT_WRIST: 9, RIGHT_WRIST: 10,
  LEFT_HIP: 11, RIGHT_HIP: 12,
  LEFT_KNEE: 13, RIGHT_KNEE: 14,
  LEFT_ANKLE: 15, RIGHT_ANKLE: 16,
}

// MoveNet emits ~0.7+ for clearly visible joints and <0.2 for occluded ones.
// 0.4 keeps confident detections while rejecting noisy, badly-positioned ones.
const MIN_CONFIDENCE = 0.4

function kp(pose, idx) {
  if (!pose || !pose.keypoints) return null
  const p = pose.keypoints[idx]
  return p && p.score > MIN_CONFIDENCE ? p : null
}

function dist(a, b) {
  if (!a || !b) return null
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function midpoint(a, b) {
  if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  return a || b || null
}

// Torso length (shoulder midpoint → hip midpoint) gives a body-relative unit so
// thresholds stay consistent whether the clip is 480p or 4K. All distance
// comparisons below are expressed as fractions of this scale (T).
function bodyScale(pose) {
  const sh = midpoint(kp(pose, KP.LEFT_SHOULDER), kp(pose, KP.RIGHT_SHOULDER))
  const hp = midpoint(kp(pose, KP.LEFT_HIP), kp(pose, KP.RIGHT_HIP))
  const d = dist(sh, hp)
  return d && d > 1 ? d : null
}

// Interior angle (degrees) at `vertex` formed by points a–vertex–c.
// Angle-based metrics are inherently resolution-independent.
function jointAngle(a, vertex, c) {
  if (!a || !vertex || !c) return null
  const v1 = { x: a.x - vertex.x, y: a.y - vertex.y }
  const v2 = { x: c.x - vertex.x, y: c.y - vertex.y }
  const dot = v1.x * v2.x + v1.y * v2.y
  const mag = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)
  if (mag === 0) return null
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * (180 / Math.PI)
}

function status(score) {
  if (score >= 78) return 'good'
  if (score >= 55) return 'needs_work'
  return 'poor'
}

function uncertain(name, message) {
  return { name, score: 60, status: 'uncertain', feedback: [message] }
}

// Detect the serving arm as the one whose wrist reaches the highest point
// (minimum y, since y increases downward) across the analyzed frames.
// Only confident detections count; falls back to right-handed if neither
// wrist is ever detected.
function detectServingArm(poses) {
  let leftMin = Infinity, rightMin = Infinity
  for (const pose of poses) {
    if (!pose) continue
    const lw = kp(pose, KP.LEFT_WRIST)
    const rw = kp(pose, KP.RIGHT_WRIST)
    if (lw) leftMin = Math.min(leftMin, lw.y)
    if (rw) rightMin = Math.min(rightMin, rw.y)
  }
  if (leftMin === Infinity && rightMin === Infinity) return 'right'
  return rightMin < leftMin ? 'right' : 'left'
}

function analyzeStance(pose, servingArm) {
  const T = bodyScale(pose)
  const lAnkle = kp(pose, KP.LEFT_ANKLE)
  const rAnkle = kp(pose, KP.RIGHT_ANKLE)
  const lShoulder = kp(pose, KP.LEFT_SHOULDER)
  const rShoulder = kp(pose, KP.RIGHT_SHOULDER)

  if (!lAnkle || !rAnkle) {
    return uncertain('Stance', 'Could not clearly detect both feet — record with your full body in frame from the front')
  }
  if (!T || !lShoulder || !rShoulder) {
    return uncertain('Stance', 'Feet detected but could not measure stance relative to your body size')
  }

  const shoulderWidth = Math.abs(lShoulder.x - rShoulder.x)

  // From a side/angled view the shoulders project narrow and the feet line up
  // along the camera's depth axis, so horizontal stance width is meaningless.
  if (shoulderWidth < 0.5 * T) {
    return {
      name: 'Stance',
      score: 65,
      status: 'uncertain',
      feedback: ['Looks like a side-view angle — stance width can\'t be measured reliably from here. Record from the front to score your stance.'],
    }
  }

  const feetWidth = Math.abs(lAnkle.x - rAnkle.x)
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

function analyzeBallToss(pose, servingArm) {
  const T = bodyScale(pose)
  // Tossing arm is opposite the serving arm
  const tossingWrist = kp(pose, servingArm === 'right' ? KP.LEFT_WRIST : KP.RIGHT_WRIST)
  const nose = kp(pose, KP.NOSE)
  const tossShoulder = kp(pose, servingArm === 'right' ? KP.LEFT_SHOULDER : KP.RIGHT_SHOULDER)

  if (!tossingWrist) {
    return uncertain('Ball Toss', 'Could not detect the tossing hand — keep your whole body visible throughout the serve')
  }
  if (!T) {
    return uncertain('Ball Toss', 'Detected the tossing hand but could not gauge your body size to judge toss height')
  }

  if (nose) {
    if (tossingWrist.y < nose.y - 0.05 * T) {
      const extended = tossShoulder && tossingWrist.y < tossShoulder.y - 0.5 * T
      return {
        name: 'Ball Toss',
        score: extended ? 92 : 82,
        status: 'good',
        feedback: [extended
          ? 'Excellent ball toss — arm fully extended above head height for a clean release'
          : 'Good toss height — wrist is above head level'],
      }
    } else if (tossingWrist.y < nose.y + 0.2 * T) {
      return { name: 'Ball Toss', score: 65, status: 'needs_work', feedback: ['Toss height is borderline — aim to release with your arm fully extended above your head for more control'] }
    }
    return { name: 'Ball Toss', score: 42, status: 'poor', feedback: ['Toss appears low — extend your arm completely and release the ball at the peak of your reach to give yourself time to prepare'] }
  }

  // No head reference — fall back to judging the wrist against the shoulder
  if (tossShoulder) {
    if (tossingWrist.y < tossShoulder.y - 0.3 * T) {
      return { name: 'Ball Toss', score: 80, status: 'good', feedback: ['Good toss height — tossing arm is well raised above the shoulder'] }
    } else if (tossingWrist.y < tossShoulder.y) {
      return { name: 'Ball Toss', score: 62, status: 'needs_work', feedback: ['Tossing arm is only slightly raised — extend it fully above your head for a higher, more controlled toss'] }
    }
    return { name: 'Ball Toss', score: 45, status: 'poor', feedback: ['Tossing arm appears low — reach up and release the ball at full extension above your head'] }
  }

  return uncertain('Ball Toss', 'Could not find a head or shoulder reference to judge toss height — try a clearer, well-lit recording')
}

function analyzeTrophyPosition(pose, servingArm) {
  const T = bodyScale(pose)
  const elbow = kp(pose, servingArm === 'right' ? KP.RIGHT_ELBOW : KP.LEFT_ELBOW)
  const shoulder = kp(pose, servingArm === 'right' ? KP.RIGHT_SHOULDER : KP.LEFT_SHOULDER)
  const knee = kp(pose, servingArm === 'right' ? KP.RIGHT_KNEE : KP.LEFT_KNEE)
  const hip = kp(pose, servingArm === 'right' ? KP.RIGHT_HIP : KP.LEFT_HIP)
  const ankle = kp(pose, servingArm === 'right' ? KP.RIGHT_ANKLE : KP.LEFT_ANKLE)

  if (!elbow || !shoulder) {
    return uncertain('Trophy Position', 'Could not detect the serving arm in the trophy frame')
  }
  if (!T) {
    return uncertain('Trophy Position', 'Detected the serving arm but could not gauge your body size')
  }

  const feedback = []
  let score = 70

  // Racket elbow vs shoulder (lower y = higher in frame)
  if (elbow.y < shoulder.y) {
    score += 15
    feedback.push('Good racket arm position — elbow is above shoulder level, creating the classic trophy shape')
  } else if (elbow.y < shoulder.y + 0.1 * T) {
    feedback.push('Racket elbow is close to shoulder height — try to raise it slightly higher for a better trophy position')
  } else {
    score -= 15
    feedback.push('Racket elbow appears below shoulder level — raise your elbow to at least shoulder height to form the trophy position')
  }

  // Knee bend measured by the hip–knee–ankle angle (180° = straight legs).
  const kneeAngle = jointAngle(hip, knee, ankle)
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

  score = Math.min(100, Math.max(0, score))
  return { name: 'Trophy Position', score, status: status(score), feedback }
}

function analyzeContact(pose, servingArm) {
  const T = bodyScale(pose)
  const wrist = kp(pose, servingArm === 'right' ? KP.RIGHT_WRIST : KP.LEFT_WRIST)
  const elbow = kp(pose, servingArm === 'right' ? KP.RIGHT_ELBOW : KP.LEFT_ELBOW)
  const shoulder = kp(pose, servingArm === 'right' ? KP.RIGHT_SHOULDER : KP.LEFT_SHOULDER)
  const nose = kp(pose, KP.NOSE)

  if (!wrist) {
    return uncertain('Contact Point', 'Could not detect the racket hand at the contact frame')
  }
  if (!T) {
    return uncertain('Contact Point', 'Detected the racket hand but could not gauge your body size')
  }

  const feedback = []
  let score = 65

  // Contact height — should be above the head
  if (nose) {
    if (wrist.y < nose.y - 0.05 * T) {
      score += 18
      feedback.push('Good contact height — racket is making contact above head level')
    } else if (wrist.y < nose.y + 0.15 * T) {
      feedback.push('Contact height is near head level — aim to reach higher for more power and a better angle over the net')
    } else {
      score -= 15
      feedback.push('Contact point appears low — reach up to strike the ball above your head for maximum power and clearance')
    }
  } else {
    feedback.push('Could not find a head reference to judge contact height — scored on arm extension only')
  }

  // Arm extension at contact (shoulder–elbow–wrist angle)
  const angle = jointAngle(shoulder, elbow, wrist)
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

  score = Math.min(100, Math.max(0, score))
  return { name: 'Contact Point', score, status: status(score), feedback }
}

function analyzeFollowThrough(pose, servingArm) {
  const T = bodyScale(pose)
  const wrist = kp(pose, servingArm === 'right' ? KP.RIGHT_WRIST : KP.LEFT_WRIST)
  const hip = kp(pose, servingArm === 'right' ? KP.RIGHT_HIP : KP.LEFT_HIP)
  const oppHip = kp(pose, servingArm === 'right' ? KP.LEFT_HIP : KP.RIGHT_HIP)

  if (!wrist) {
    return uncertain('Follow-Through', 'Could not detect the follow-through position clearly')
  }

  if (hip && oppHip && T) {
    const midX = (hip.x + oppHip.x) / 2
    // Serving arm should cross to the opposite side of the body
    const crossed = servingArm === 'right' ? wrist.x < midX : wrist.x > midX
    const distFromMid = Math.abs(wrist.x - midX)

    if (crossed) {
      return { name: 'Follow-Through', score: 90, status: 'good', feedback: ['Complete follow-through — racket arm has crossed the body correctly, promoting spin and control'] }
    } else if (distFromMid < 0.25 * T) {
      return { name: 'Follow-Through', score: 68, status: 'needs_work', feedback: ['Follow-through almost complete — let the racket continue swinging fully across your body to the opposite hip'] }
    }
    return { name: 'Follow-Through', score: 48, status: 'poor', feedback: ['Incomplete follow-through — allow the racket to swing naturally all the way across your body. Stopping early reduces spin and increases injury risk'] }
  }

  return { name: 'Follow-Through', score: 65, status: 'needs_work', feedback: ['Follow-through detected — ensure the racket swings completely across your body toward the opposite hip for maximum spin and safety'] }
}

export function analyzeServe(poses) {
  if (!poses || poses.every(p => !p)) {
    return {
      overallScore: 0,
      servingArm: 'right',
      warning: 'No body detected in any frame. Make sure your full body is clearly visible in the video.',
      phases: [],
    }
  }

  const servingArm = detectServingArm(poses)

  const phases = [
    analyzeStance(poses[0], servingArm),
    analyzeBallToss(poses[1], servingArm),
    analyzeTrophyPosition(poses[2], servingArm),
    analyzeContact(poses[4], servingArm),
    analyzeFollowThrough(poses[5], servingArm),
  ]

  const scores = phases.map(p => p.score)
  const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)

  return { overallScore, servingArm, phases }
}
