import { useEffect, useRef } from 'react'
import { drawSkeleton } from '../utils/poseDetector'

const DISPLAY_WIDTH = 280

// BlazePose returns 33 keypoints; use a fraction (rather than the old fixed
// counts tuned for MoveNet's 17) so the quality label scales correctly.
function qualityFromPose(pose) {
  if (!pose || !pose.keypoints) return { label: 'None', color: 'text-red-400' }
  const total = pose.keypoints.length
  const visible = pose.keypoints.filter(k => k.score > 0.5).length
  const ratio = visible / total
  if (ratio >= 0.7) return { label: 'High',   color: 'text-green-400' }
  if (ratio >= 0.4) return { label: 'Medium', color: 'text-yellow-400' }
  return { label: 'Low', color: 'text-red-400' }
}

function FrameCard({ frame, pose, index }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame?.dataUrl) return

    let cancelled = false
    const ctx = canvas.getContext('2d')
    const img = new Image()

    img.onload = () => {
      if (cancelled) return

      const aspectRatio = img.height / img.width
      canvas.width = DISPLAY_WIDTH
      canvas.height = Math.round(DISPLAY_WIDTH * aspectRatio)

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      if (pose) {
        const scaleX = canvas.width / img.width
        const scaleY = canvas.height / img.height
        drawSkeleton(ctx, pose, scaleX, scaleY)
      }
    }

    img.src = frame.dataUrl

    return () => { cancelled = true }
  }, [frame?.dataUrl, pose])

  const { label, color } = qualityFromPose(pose)

  // No frame for this phase — the detector couldn't pick one. Render a
  // placeholder so the gallery still shows all 5 phase slots.
  if (!frame?.dataUrl) {
    return (
      <div className="flex flex-col gap-2">
        <div className="relative bg-gray-900 rounded-lg overflow-hidden border border-gray-700 aspect-video flex items-center justify-center">
          <span className="text-gray-600 text-xs">Not detected</span>
        </div>
        <div className="text-center">
          <p className="text-xs font-medium text-white">{frame?.label || `Phase ${index + 1}`}</p>
          <p className="text-xs text-red-400">No frame</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative bg-gray-900 rounded-lg overflow-hidden border border-gray-700">
        <canvas
          ref={canvasRef}
          className="w-full h-auto block"
        />
        <div className="absolute top-1.5 left-1.5">
          <span className="text-xs font-semibold bg-black/70 text-white px-2 py-0.5 rounded-full">
            {index + 1}
          </span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs font-medium text-white">{frame.label}</p>
        <p className={`text-xs ${color}`}>Pose: {label}</p>
      </div>
    </div>
  )
}

export default function FrameGallery({ frames, poses }) {
  if (!frames || frames.length === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Analyzed Phase Frames</h2>
        <span className="text-xs text-gray-500">Dynamically picked from the serve motion</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {frames.map((frame, i) => (
          <FrameCard key={i} frame={frame} pose={poses[i]} index={i} />
        ))}
      </div>
    </div>
  )
}
