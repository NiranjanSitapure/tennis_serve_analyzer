const STEPS = [
  { label: 'Extracting frames', desc: 'Capturing 6 key moments from your video' },
  { label: 'Detecting pose', desc: 'AI locating body keypoints in each frame' },
  { label: 'Analyzing form', desc: 'Scoring each phase of your serve technique' },
]

export default function AnalysisProgress({ progress, onCancel }) {
  return (
    <div className="py-20 flex flex-col items-center text-center">
      <div className="text-6xl mb-6 animate-spin-slow">🎾</div>
      <h2 className="text-2xl font-bold text-white mb-2">Analyzing Your Serve</h2>
      <p className="text-gray-400 mb-12 max-w-sm">{progress.message}</p>

      <div className="w-full max-w-md space-y-3">
        {STEPS.map((step, i) => {
          const done = i < progress.step
          const active = i === progress.step
          return (
            <div
              key={step.label}
              className={`flex items-center gap-4 p-4 rounded-xl border transition-all duration-500
                ${active
                  ? 'bg-green-900/30 border-green-500/40'
                  : done
                    ? 'bg-gray-800/60 border-gray-700'
                    : 'bg-gray-900/30 border-gray-800 opacity-40'
                }`}
            >
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold transition-all
                  ${done ? 'bg-green-500 text-white' : active ? 'bg-green-600/60 text-white animate-pulse' : 'bg-gray-700 text-gray-400'}`}
              >
                {done ? '✓' : i + 1}
              </div>
              <div className="text-left">
                <p className={`font-medium text-sm ${active || done ? 'text-white' : 'text-gray-500'}`}>{step.label}</p>
                <p className="text-gray-500 text-xs mt-0.5">{step.desc}</p>
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-gray-600 text-xs mt-10">
        First run downloads the AI model (~5 MB) and may take 10–20 seconds
      </p>

      {onCancel && (
        <button
          onClick={onCancel}
          className="mt-6 text-sm text-gray-400 hover:text-white border border-gray-600 hover:border-gray-400 px-5 py-2 rounded-lg transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  )
}
