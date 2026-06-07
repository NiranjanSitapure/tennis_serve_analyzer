import * as tf from '@tensorflow/tfjs'
import * as poseDetection from '@tensorflow-models/pose-detection'

let detector = null

export async function loadModel() {
  if (detector) return detector

  await tf.ready()

  detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      enableSmoothing: false,
    }
  )

  return detector
}

export async function detectPoseFromCanvas(canvas) {
  if (!detector) throw new Error('Pose detection model is not loaded.')
  const poses = await detector.estimatePoses(canvas)
  return poses[0] || null
}

// Connections between keypoint pairs for skeleton rendering
const SKELETON_CONNECTIONS = [
  [5, 6],   // shoulders
  [5, 7], [7, 9],   // left arm
  [6, 8], [8, 10],  // right arm
  [5, 11], [6, 12], // torso sides
  [11, 12],         // hips
  [11, 13], [13, 15], // left leg
  [12, 14], [14, 16], // right leg
]

export function drawSkeleton(ctx, pose, scaleX, scaleY) {
  if (!pose || !pose.keypoints) return

  const kps = pose.keypoints

  ctx.save()

  // Draw connections
  ctx.strokeStyle = '#00ff88'
  ctx.lineWidth = 2.5
  ctx.shadowColor = '#00ff88'
  ctx.shadowBlur = 6

  for (const [i, j] of SKELETON_CONNECTIONS) {
    const a = kps[i]
    const b = kps[j]
    if (!a || !b || a.score < 0.25 || b.score < 0.25) continue
    ctx.beginPath()
    ctx.moveTo(a.x * scaleX, a.y * scaleY)
    ctx.lineTo(b.x * scaleX, b.y * scaleY)
    ctx.stroke()
  }

  ctx.shadowBlur = 0

  // Draw keypoints
  for (const kp of kps) {
    if (!kp || kp.score < 0.25) continue
    ctx.fillStyle = '#ff3a6e'
    ctx.beginPath()
    ctx.arc(kp.x * scaleX, kp.y * scaleY, 4, 0, 2 * Math.PI)
    ctx.fill()
  }

  ctx.restore()
}
