// Surfaced when the multi-signal handedness detector reports confidence < 0.3.
// Lightweight modal — picks left, right, or keeps the algorithm's best guess.
export default function HandednessPrompt({ detectedHand, confidence, onConfirm }) {
  const pct = Math.round(confidence * 100)
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full p-6">
        <h2 className="text-xl font-bold text-white mb-2">Which hand do you serve with?</h2>
        <p className="text-gray-400 text-sm mb-5">
          The AI couldn't tell for sure ({pct}% confidence). Pick a hand so the rest of the
          analysis uses the right arm — without this, scores may be wrong.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={() => onConfirm('left')}
            className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white font-semibold py-3 rounded-lg transition-colors"
          >
            🤚 Left-handed
          </button>
          <button
            onClick={() => onConfirm('right')}
            className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white font-semibold py-3 rounded-lg transition-colors"
          >
            ✋ Right-handed
          </button>
        </div>

        <button
          onClick={() => onConfirm(detectedHand)}
          className="w-full text-sm text-gray-400 hover:text-white transition-colors py-2"
        >
          Use the AI's guess ({detectedHand}-handed) →
        </button>
      </div>
    </div>
  )
}
