import { OneEuroFilter } from '1eurofilter'

// OneEuro filter: a real-time low-pass filter with adaptive cutoff frequency.
// `minCutoff` controls smoothing of slow signals (lower = smoother).
// `beta` controls how aggressively the cutoff rises with speed (higher = less
// lag during fast motion). Defaults are the algorithm reference values from
// Casiez et al.; raise beta if the racket arm visibly lags at contact.
const DEFAULTS = {
  freq: 10,         // we sample at ~10 FPS
  minCutoff: 1.0,
  beta: 0.05,       // higher than the original 0.007 — serves have fast arm whip
  dCutoff: 1.0,
}

// Smooth a sequence of poses. Each pose is the result of
// `detectPoseFromCanvas` (BlazePose) with `keypoints` (2D image px) and
// `keypoints3D` (hip-centered meters). We smooth every (joint, axis) channel
// independently across the sequence. Frames where a pose is null are passed
// through unchanged; the per-joint filters skip those samples.
//
// `frames` is the corresponding frame metadata array (with .timestamp); used
// to provide accurate dt to the filter.
export function smoothPoseSequence(poses, frames) {
  if (!poses || poses.length === 0) return poses

  const firstPose = poses.find(p => p && p.keypoints) || null
  if (!firstPose) return poses

  const n2D = firstPose.keypoints.length
  const has3D = !!(firstPose.keypoints3D && firstPose.keypoints3D.length > 0)
  const n3D = has3D ? firstPose.keypoints3D.length : 0

  // Build a filter per (joint, axis). 2D channels: x, y. 3D channels: x, y, z.
  // We do NOT smooth `score` — it's a confidence label, not a signal.
  const makeFilter = () => new OneEuroFilter(DEFAULTS.freq, DEFAULTS.minCutoff, DEFAULTS.beta, DEFAULTS.dCutoff)
  const filters2D = Array.from({ length: n2D }, () => ({ x: makeFilter(), y: makeFilter() }))
  const filters3D = Array.from({ length: n3D }, () => ({ x: makeFilter(), y: makeFilter(), z: makeFilter() }))

  return poses.map((pose, i) => {
    if (!pose || !pose.keypoints) return pose
    const t = frames && frames[i] && typeof frames[i].timestamp === 'number'
      ? frames[i].timestamp
      : i / DEFAULTS.freq

    const smoothedKp = pose.keypoints.map((kp, j) => {
      if (!kp) return kp
      return {
        ...kp,
        x: filters2D[j].x.filter(kp.x, t),
        y: filters2D[j].y.filter(kp.y, t),
      }
    })

    let smoothedKp3D = pose.keypoints3D
    if (has3D && pose.keypoints3D) {
      smoothedKp3D = pose.keypoints3D.map((kp, j) => {
        if (!kp) return kp
        return {
          ...kp,
          x: filters3D[j].x.filter(kp.x, t),
          y: filters3D[j].y.filter(kp.y, t),
          z: filters3D[j].z.filter(kp.z, t),
        }
      })
    }

    return { ...pose, keypoints: smoothedKp, keypoints3D: smoothedKp3D }
  })
}
