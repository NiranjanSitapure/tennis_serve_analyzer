let detector = null
let modelPromise = null

export async function loadModel() {
  if (detector) return detector
  // Cache the in-flight promise so concurrent callers (e.g. a double-click)
  // share one createDetector call instead of building duplicate detectors.
  if (modelPromise) return modelPromise

  modelPromise = (async () => {
    // Dynamic import keeps the TF.js bundle out of the initial page load —
    // it is only fetched once the user starts an analysis.
    const tf = await import('@tensorflow/tfjs')
    const poseDetection = await import('@tensorflow-models/pose-detection')

    await tf.ready()

    // BlazePose returns 33 landmarks + a parallel keypoints3D array of
    // hip-centered world coordinates in meters. The 3D coords are what kill
    // camera-angle bias for the stance check.
    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.BlazePose,
      {
        runtime: 'tfjs',
        modelType: 'full',     // lite=fast/less accurate; heavy=overkill
        enableSmoothing: false, // we run our own OneEuro smoothing across frames
      }
    )
    return detector
  })()

  try {
    return await modelPromise
  } catch (err) {
    // Reset so a later attempt can retry instead of being stuck on a rejected promise.
    modelPromise = null
    throw err
  }
}

export async function detectPoseFromCanvas(canvas) {
  if (!detector) throw new Error('Pose detection model is not loaded.')
  const poses = await detector.estimatePoses(canvas)
  return poses[0] || null
}

// BlazePose 33-landmark connections (face, torso, limbs, feet).
// Index reference: see BlazePose Landmark layout in MediaPipe docs.
const SKELETON_CONNECTIONS = [
  // Face outline (light)
  [0, 2], [2, 5], [5, 7], [0, 5],
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  // Right arm
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // Left leg + foot
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  // Right leg + foot
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
]

const SKELETON_MIN_SCORE = 0.5

export function drawSkeleton(ctx, pose, scaleX, scaleY) {
  if (!pose || !pose.keypoints) return

  const kps = pose.keypoints

  ctx.save()

  ctx.strokeStyle = '#00ff88'
  ctx.lineWidth = 2.5
  ctx.shadowColor = '#00ff88'
  ctx.shadowBlur = 6

  for (const [i, j] of SKELETON_CONNECTIONS) {
    const a = kps[i]
    const b = kps[j]
    if (!a || !b || a.score < SKELETON_MIN_SCORE || b.score < SKELETON_MIN_SCORE) continue
    ctx.beginPath()
    ctx.moveTo(a.x * scaleX, a.y * scaleY)
    ctx.lineTo(b.x * scaleX, b.y * scaleY)
    ctx.stroke()
  }

  ctx.shadowBlur = 0

  for (const kp of kps) {
    if (!kp || kp.score < SKELETON_MIN_SCORE) continue
    ctx.fillStyle = '#ff3a6e'
    ctx.beginPath()
    ctx.arc(kp.x * scaleX, kp.y * scaleY, 4, 0, 2 * Math.PI)
    ctx.fill()
  }

  ctx.restore()
}
