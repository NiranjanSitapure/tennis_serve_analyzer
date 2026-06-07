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

function kp(pose, idx) {
  if (!pose || !pose.keypoints) return null
  const p = pose.keypoints[idx]
  return p && p.score > 0.25 ? p : null
}

function dist(a, b) {
  if (!a || !b) return null
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

function elbowAngle(shoulder, elbow, wrist) {
  if (!shoulder || !elbow || !wrist) return null
  const ab = { x: shoulder.x - elbow.x, y: shoulder.y - elbow.y }
  const cb = { x: wrist.x - elbow.x, y: wrist.y - elbow.y }
  const dot = ab.x * cb.x + ab.y * cb.y
  const mag = Math.sqrt(ab.x ** 2 + ab.y ** 2) * Math.sqrt(cb.x ** 2 + cb.y ** 2)
  if (mag === 0) return null
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * (180 / Math.PI)
}

function status(score) {
  if (score >= 78) return 'good'
  if (score >= 55) return 'needs_work'
  return 'poor'
}

// Detect which arm is the serving arm (the one that reaches highest in the video).
// In image coords y increases downward, so minimum y = highest point.
function detectServingArm(poses) {
  let leftMin = Infinity, rightMin = Infinity
  for (const pose of poses) {
    if (!pose) continue
    const lw = kp(pose, KP.LEFT_WRIST)
    const rw = kp(pose, KP.RIGHT_WRIST)
    if (lw) leftMin = Math.min(leftMin, lw.y)
    if (rw) rightMin = Math.min(rightMin, rw.y)
  }
  return rightMin < leftMin ? 'right' : 'left'
}

function analyzeStance(pose, servingArm) {
  const ankle = kp(pose, servingArm === 'right' ? KP.RIGHT_ANKLE : KP.LEFT_ANKLE)
  const oppAnkle = kp(pose, servingArm === 'right' ? KP.LEFT_ANKLE : KP.RIGHT_ANKLE)
  const shoulder = kp(pose, KP.LEFT_SHOULDER)
  const oppShoulder = kp(pose, KP.RIGHT_SHOULDER)

  if (!ankle || !oppAnkle) {
    return {
      name: 'Stance',
      score: 60,
      status: 'uncertain',
      feedback: ['Could not clearly detect foot position — try recording with your full body in frame from the side or front'],
    }
  }

  const feetWidth = Math.abs(ankle.x - oppAnkle.x)
  const shoulderWidth = shoulder && oppShoulder ? Math.abs(shoulder.x - oppShoulder.x) : null

  if (!shoulderWidth) {
    return { name: 'Stance', score: 65, status: 'needs_work', feedback: ['Feet detected but could not measure stance relative to shoulder width'] }
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

function analyzeBallToss(pose, servingArm) {
  // Tossing arm is opposite to serving arm
  const tossingWrist = kp(pose, servingArm === 'right' ? KP.LEFT_WRIST : KP.RIGHT_WRIST)
  const nose = kp(pose, KP.NOSE)
  const tossShoulder = kp(pose, servingArm === 'right' ? KP.LEFT_SHOULDER : KP.RIGHT_SHOULDER)

  if (!tossingWrist) {
    return { name: 'Ball Toss', score: 55, status: 'uncertain', feedback: ['Could not detect tossing hand — make sure your full body is visible throughout the serve'] }
  }

  // y increases downward: lower y value = higher position in frame
  if (nose && tossingWrist.y < nose.y - 10) {
    const extended = tossShoulder && tossingWrist.y < tossShoulder.y - 80
    const score = extended ? 92 : 82
    const msg = extended
      ? 'Excellent ball toss — arm fully extended above head height for a clean release'
      : 'Good toss height — wrist is above head level'
    return { name: 'Ball Toss', score, status: 'good', feedback: [msg] }
  } else if (nose && tossingWrist.y < nose.y + 40) {
    return { name: 'Ball Toss', score: 65, status: 'needs_work', feedback: ['Toss height is borderline — aim to release with your arm fully extended above your head for more control'] }
  } else {
    return { name: 'Ball Toss', score: 42, status: 'poor', feedback: ['Toss appears low — extend your arm completely and release the ball at the peak of your reach to give yourself time to prepare'] }
  }
}

function analyzeTrophyPosition(pose, servingArm) {
  const elbow = kp(pose, servingArm === 'right' ? KP.RIGHT_ELBOW : KP.LEFT_ELBOW)
  const shoulder = kp(pose, servingArm === 'right' ? KP.RIGHT_SHOULDER : KP.LEFT_SHOULDER)
  const knee = kp(pose, servingArm === 'right' ? KP.RIGHT_KNEE : KP.LEFT_KNEE)
  const hip = kp(pose, servingArm === 'right' ? KP.RIGHT_HIP : KP.LEFT_HIP)

  if (!elbow || !shoulder) {
    return { name: 'Trophy Position', score: 55, status: 'uncertain', feedback: ['Could not detect serving arm position in the trophy frame'] }
  }

  const feedback = []
  let score = 70

  // Elbow above shoulder (lower y = higher in image)
  if (elbow.y < shoulder.y) {
    score += 15
    feedback.push('Good racket arm position — elbow is above shoulder level, creating the classic trophy shape')
  } else if (elbow.y < shoulder.y + 20) {
    feedback.push('Racket elbow is close to shoulder height — try to raise it slightly higher for a better trophy position')
  } else {
    score -= 15
    feedback.push('Racket elbow appears below shoulder level — raise your elbow to at least shoulder height to form the trophy position')
  }

  // Knee bend
  if (knee && hip) {
    const bend = knee.y - hip.y
    if (bend > 50) {
      score += 10
      feedback.push('Nice knee bend — leg drive will add significant power to your serve')
    } else if (bend > 25) {
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
  const wrist = kp(pose, servingArm === 'right' ? KP.RIGHT_WRIST : KP.LEFT_WRIST)
  const elbow = kp(pose, servingArm === 'right' ? KP.RIGHT_ELBOW : KP.LEFT_ELBOW)
  const shoulder = kp(pose, servingArm === 'right' ? KP.RIGHT_SHOULDER : KP.LEFT_SHOULDER)
  const nose = kp(pose, KP.NOSE)

  if (!wrist) {
    return { name: 'Contact Point', score: 55, status: 'uncertain', feedback: ['Could not detect racket hand position at contact frame'] }
  }

  const feedback = []
  let score = 65

  // Wrist height: should be above head
  if (nose && wrist.y < nose.y - 5) {
    score += 18
    feedback.push('Good contact height — racket is making contact above head level')
  } else if (nose && wrist.y < nose.y + 20) {
    feedback.push('Contact height is near head level — aim to reach higher for more power and a better angle over the net')
  } else {
    score -= 15
    feedback.push('Contact point appears low — reach up to strike the ball above your head for maximum power and clearance')
  }

  // Arm extension at contact
  const angle = elbowAngle(shoulder, elbow, wrist)
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
  const wrist = kp(pose, servingArm === 'right' ? KP.RIGHT_WRIST : KP.LEFT_WRIST)
  const hip = kp(pose, servingArm === 'right' ? KP.RIGHT_HIP : KP.LEFT_HIP)
  const oppHip = kp(pose, servingArm === 'right' ? KP.LEFT_HIP : KP.RIGHT_HIP)

  if (!wrist) {
    return { name: 'Follow-Through', score: 55, status: 'uncertain', feedback: ['Could not detect follow-through position clearly'] }
  }

  if (hip && oppHip) {
    const midX = (hip.x + oppHip.x) / 2
    // Serving arm should cross to opposite side
    const crossed = servingArm === 'right' ? wrist.x < midX : wrist.x > midX
    const distFromMid = Math.abs(wrist.x - midX)

    if (crossed) {
      return { name: 'Follow-Through', score: 90, status: 'good', feedback: ['Complete follow-through — racket arm has crossed the body correctly, promoting spin and control'] }
    } else if (distFromMid < 40) {
      return { name: 'Follow-Through', score: 68, status: 'needs_work', feedback: ['Follow-through almost complete — let the racket continue swinging fully across your body to the opposite hip'] }
    } else {
      return { name: 'Follow-Through', score: 48, status: 'poor', feedback: ['Incomplete follow-through — allow the racket to swing naturally all the way across your body. Stopping early reduces spin and increases injury risk'] }
    }
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
