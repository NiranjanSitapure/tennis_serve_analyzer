import { useState, useRef } from 'react'
import VideoUpload from './components/VideoUpload'
import AnalysisProgress from './components/AnalysisProgress'
import FrameGallery from './components/FrameGallery'
import ScoreCard from './components/ScoreCard'
import PhaseAnalysis from './components/PhaseAnalysis'
import HandednessPrompt from './components/HandednessPrompt'
import { extractFrames, frameToDataUrl } from './utils/videoProcessor'
import { loadModel, detectPoseFromCanvas } from './utils/poseDetector'
import { smoothPoseSequence } from './utils/temporalSmoother'
import { detectHandedness } from './utils/handednessDetector'
import { detectPhases } from './utils/phaseDetector'
import { analyzeServe } from './utils/serveAnalyzer'

const HANDEDNESS_CONFIDENCE_THRESHOLD = 0.3

export default function App() {
  const [status, setStatus] = useState('idle')       // idle | analyzing | needs_handedness | results | error
  const [videoFile, setVideoFile] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)
  const [displayFrames, setDisplayFrames] = useState([])
  const [displayPoses, setDisplayPoses] = useState([])
  const [analysis, setAnalysis] = useState(null)
  const [progress, setProgress] = useState({ step: 0, message: 'Starting...' })
  const [errorMsg, setErrorMsg] = useState('')

  // Handedness uncertainty state — set when the detector confidence is below
  // the threshold and the user needs to confirm before scoring proceeds.
  const [pendingHandedness, setPendingHandedness] = useState(null) // { hand, confidence }
  // Cached intermediates so the user's handedness choice can be applied
  // without re-running pose detection.
  const cachedRef = useRef(null)
  const cancelRef = useRef(false)

  function handleVideoSelect(file) {
    setVideoFile(file)
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoUrl(URL.createObjectURL(file))
    setStatus('idle')
    setDisplayFrames([])
    setDisplayPoses([])
    setAnalysis(null)
    setErrorMsg('')
    setPendingHandedness(null)
    cachedRef.current = null
  }

  async function runAnalysis() {
    if (!videoFile) return
    cancelRef.current = false
    setStatus('analyzing')
    setErrorMsg('')

    try {
      // Step 1 — dense frame extraction (10 FPS)
      setProgress({ step: 0, message: 'Extracting frames from video...' })
      const frames = await extractFrames(videoFile, (i, total) => {
        setProgress({ step: 0, message: `Extracting frames — ${i} of ${total}` })
      })
      if (cancelRef.current) return

      // Step 2 — load model
      setProgress({ step: 1, message: 'Loading BlazePose model (first run may take ~15 s)...' })
      await loadModel()
      if (cancelRef.current) return

      // Step 3 — pose detect every frame
      const rawPoses = []
      for (let i = 0; i < frames.length; i++) {
        setProgress({ step: 1, message: `Detecting pose — frame ${i + 1} of ${frames.length}` })
        const pose = await detectPoseFromCanvas(frames[i].canvas)
        if (cancelRef.current) return
        rawPoses.push(pose)
      }

      // Step 4 — temporal smoothing
      setProgress({ step: 2, message: 'Smoothing keypoint trajectories...' })
      const smoothedPoses = smoothPoseSequence(rawPoses, frames)

      // Step 5 — handedness detection
      const handednessResult = detectHandedness(smoothedPoses, frames)
      console.debug('Handedness detection:', handednessResult)

      // Cache so the user's handedness confirmation (if needed) can finish
      // analysis without re-running everything.
      cachedRef.current = { frames, smoothedPoses, handednessResult }

      if (handednessResult.confidence < HANDEDNESS_CONFIDENCE_THRESHOLD) {
        setPendingHandedness({
          hand: handednessResult.hand,
          confidence: handednessResult.confidence,
        })
        setStatus('needs_handedness')
        return
      }

      finishAnalysis(handednessResult.hand, handednessResult.confidence)
    } catch (err) {
      if (cancelRef.current) return
      console.error('Analysis error:', err)
      setErrorMsg(err.message || 'Analysis failed. Please try again with a different video.')
      setStatus('error')
    }
  }

  // Phase detection + scoring. Called either directly from runAnalysis or
  // after the user confirms handedness via the modal.
  function finishAnalysis(handedness, handednessConfidence) {
    const cached = cachedRef.current
    if (!cached) return
    const { frames, smoothedPoses } = cached

    setStatus('analyzing')
    setProgress({ step: 2, message: 'Detecting serve phases...' })

    const phases = detectPhases(smoothedPoses, frames, handedness)
    const result = analyzeServe({ phases, handedness, handednessConfidence })

    // Build display data for the 5 phase frames only (skip the bulk).
    const displayFrames = phases.map((p, i) => {
      if (!p.frame) return { label: p.name, dataUrl: null, width: 0, height: 0 }
      return {
        label: p.name,
        dataUrl: frameToDataUrl(p.frame),
        timestamp: p.frame.timestamp,
        width: p.frame.width,
        height: p.frame.height,
      }
    })

    setDisplayFrames(displayFrames)
    setDisplayPoses(phases.map(p => p.pose))
    setAnalysis(result)
    setPendingHandedness(null)
    setStatus('results')
  }

  function onConfirmHandedness(hand) {
    finishAnalysis(hand, cachedRef.current.handednessResult.confidence)
  }

  function cancelAnalysis() {
    cancelRef.current = true
    setDisplayFrames([])
    setDisplayPoses([])
    setAnalysis(null)
    setPendingHandedness(null)
    cachedRef.current = null
    setStatus('idle')
  }

  function reset() {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoFile(null)
    setVideoUrl(null)
    setDisplayFrames([])
    setDisplayPoses([])
    setAnalysis(null)
    setPendingHandedness(null)
    cachedRef.current = null
    setStatus('idle')
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl select-none">🎾</span>
            <div>
              <h1 className="text-lg font-bold text-white leading-none">Tennis Serve Analyzer</h1>
              <p className="text-xs text-gray-500 mt-0.5">AI-powered form analysis · BlazePose 3D</p>
            </div>
          </div>
          {status === 'results' && (
            <button
              onClick={reset}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              ← Analyze Another
            </button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {status === 'idle' && (
          <VideoUpload
            onVideoSelect={handleVideoSelect}
            videoFile={videoFile}
            videoUrl={videoUrl}
            onAnalyze={runAnalysis}
          />
        )}

        {status === 'analyzing' && (
          <AnalysisProgress progress={progress} onCancel={cancelAnalysis} />
        )}

        {status === 'error' && (
          <div className="py-20 text-center">
            <p className="text-4xl mb-6">⚠️</p>
            <p className="text-red-400 text-lg font-medium mb-2">Analysis Failed</p>
            <p className="text-gray-400 text-sm mb-8 max-w-md mx-auto">{errorMsg}</p>
            <button
              onClick={() => setStatus('idle')}
              className="bg-green-600 hover:bg-green-500 text-white font-semibold px-8 py-2.5 rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {status === 'results' && analysis && (
          <div className="space-y-8">
            <FrameGallery frames={displayFrames} poses={displayPoses} />
            <ScoreCard analysis={analysis} />
            <PhaseAnalysis phases={analysis.phases} />
          </div>
        )}
      </main>

      {status === 'needs_handedness' && pendingHandedness && (
        <HandednessPrompt
          detectedHand={pendingHandedness.hand}
          confidence={pendingHandedness.confidence}
          onConfirm={onConfirmHandedness}
        />
      )}
    </div>
  )
}
