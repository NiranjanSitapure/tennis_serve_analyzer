import { useState, useRef } from 'react'
import VideoUpload from './components/VideoUpload'
import AnalysisProgress from './components/AnalysisProgress'
import FrameGallery from './components/FrameGallery'
import ScoreCard from './components/ScoreCard'
import PhaseAnalysis from './components/PhaseAnalysis'
import { extractFrames } from './utils/videoProcessor'
import { loadModel, detectPoseFromCanvas } from './utils/poseDetector'
import { analyzeServe } from './utils/serveAnalyzer'

export default function App() {
  const [status, setStatus] = useState('idle')       // idle | analyzing | results | error
  const [videoFile, setVideoFile] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)
  const [frames, setFrames] = useState([])            // display data (no canvas)
  const [poses, setPoses] = useState([])
  const [analysis, setAnalysis] = useState(null)
  const [progress, setProgress] = useState({ step: 0, message: 'Starting...' })
  const [errorMsg, setErrorMsg] = useState('')

  // Keep canvas references separate from React state to avoid serialization issues
  const canvasesRef = useRef([])

  function handleVideoSelect(file) {
    setVideoFile(file)
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoUrl(URL.createObjectURL(file))
    setStatus('idle')
    setFrames([])
    setPoses([])
    setAnalysis(null)
    setErrorMsg('')
    canvasesRef.current = []
  }

  async function runAnalysis() {
    if (!videoFile) return
    setStatus('analyzing')
    setErrorMsg('')

    try {
      // Step 1 — extract frames
      setProgress({ step: 0, message: 'Extracting key frames from video...' })
      const extracted = await extractFrames(videoFile)

      canvasesRef.current = extracted.map(f => f.canvas)
      // Store display-only data in state (canvas excluded to keep state serializable)
      setFrames(extracted.map(({ canvas: _c, ...rest }) => rest))

      // Step 2 — load model
      setProgress({ step: 1, message: 'Loading AI model (first run may take ~15 s)...' })
      await loadModel()

      // Step 3 — detect poses frame by frame
      const detected = []
      for (let i = 0; i < canvasesRef.current.length; i++) {
        setProgress({ step: 1, message: `Detecting pose — frame ${i + 1} of ${canvasesRef.current.length}` })
        const pose = await detectPoseFromCanvas(canvasesRef.current[i])
        detected.push(pose)
      }
      setPoses(detected)

      // Step 4 — biomechanical analysis
      setProgress({ step: 2, message: 'Scoring your serve technique...' })
      const result = analyzeServe(detected)
      setAnalysis(result)

      setStatus('results')
    } catch (err) {
      console.error('Analysis error:', err)
      setErrorMsg(err.message || 'Analysis failed. Please try again with a different video.')
      setStatus('error')
    }
  }

  function reset() {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoFile(null)
    setVideoUrl(null)
    setFrames([])
    setPoses([])
    setAnalysis(null)
    canvasesRef.current = []
    setStatus('idle')
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl select-none">🎾</span>
            <div>
              <h1 className="text-lg font-bold text-white leading-none">Tennis Serve Analyzer</h1>
              <p className="text-xs text-gray-500 mt-0.5">AI-powered form analysis</p>
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

      {/* Main content */}
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
          <AnalysisProgress progress={progress} />
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
            <FrameGallery frames={frames} poses={poses} />
            <ScoreCard analysis={analysis} />
            <PhaseAnalysis phases={analysis.phases} />
          </div>
        )}
      </main>
    </div>
  )
}
