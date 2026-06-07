import { useEffect, useRef } from 'react'
import { drawSkeleton } from '../utils/poseDetector'

const DISPLAY_WIDTH = 280

function FrameCard({ frame, pose, index }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame?.dataUrl) return

    const ctx = canvas.getContext('2d')
    const img = new Image()

    img.onload = () => {
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
  }, [frame?.dataUrl, pose])

  const confidence = pose
    ? pose.keypoints.filter(k => k.score > 0.25).length
    : 0
  const qualityLabel = confidence >= 12 ? 'High' : confidence >= 7 ? 'Medium' : pose ? 'Low' : 'None'
  const qualityColor = confidence >= 12 ? 'text-green-400' : confidence >= 7 ? 'text-yellow-400' : 'text-red-400'

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
        <p className={`text-xs ${qualityColor}`}>Pose: {qualityLabel}</p>
      </div>
    </div>
  )
}

export default function FrameGallery({ frames, poses }) {
  if (!frames || frames.length === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Analyzed Frames</h2>
        <span className="text-xs text-gray-500">Pose skeleton overlaid on each frame</span>
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {frames.map((frame, i) => (
          <FrameCard key={i} frame={frame} pose={poses[i]} index={i} />
        ))}
      </div>
    </div>
  )
}
