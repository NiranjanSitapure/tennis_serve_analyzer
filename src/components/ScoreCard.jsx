function CircularScore({ score }) {
  const r = 54
  const circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ

  const color = score >= 78 ? '#22c55e' : score >= 55 ? '#f59e0b' : '#ef4444'
  const label = score >= 78 ? 'Excellent' : score >= 65 ? 'Good Form' : score >= 45 ? 'Keep Practicing' : 'Needs Work'

  return (
    <div className="flex flex-col items-center">
      <svg width="148" height="148" viewBox="0 0 148 148">
        <circle cx="74" cy="74" r={r} fill="none" stroke="#1f2937" strokeWidth="11" />
        <circle
          cx="74" cy="74" r={r}
          fill="none"
          stroke={color}
          strokeWidth="11"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 74 74)"
          style={{ transition: 'stroke-dashoffset 1.5s cubic-bezier(0.4,0,0.2,1)' }}
        />
        <text x="74" y="69" textAnchor="middle" fill="white" fontSize="32" fontWeight="bold" fontFamily="system-ui">
          {score}
        </text>
        <text x="74" y="90" textAnchor="middle" fill="#6b7280" fontSize="13" fontFamily="system-ui">
          / 100
        </text>
      </svg>
      <span className="text-base font-semibold mt-1" style={{ color }}>{label}</span>
    </div>
  )
}

function CompositeBar({ label, score, weight, hint }) {
  const color =
    score >= 78 ? 'bg-green-500'
    : score >= 55 ? 'bg-yellow-500'
    : 'bg-red-500'
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 shrink-0">
        <p className="text-sm text-gray-300">{label}</p>
        <p className="text-xs text-gray-500">{weight}% of total · {hint}</p>
      </div>
      <div className="flex-1 bg-gray-700 rounded-full h-2.5">
        <div
          className={`h-2.5 rounded-full ${color} transition-all duration-1000`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-sm font-bold text-white w-8 text-right">{score}</span>
    </div>
  )
}

export default function ScoreCard({ analysis }) {
  const { overallScore, phases, servingArm, warning, composite, handednessConfidence } = analysis

  return (
    <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
      <h2 className="text-lg font-semibold text-white mb-6">Overall Score</h2>

      {warning && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-3 mb-6 text-sm text-yellow-300">
          ⚠ {warning}
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-8 items-center">
        <CircularScore score={overallScore} />

        <div className="flex-1 space-y-4 w-full">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">
            Detected: {servingArm}-handed serve
            {handednessConfidence != null && (
              <span className="text-gray-600"> · confidence {Math.round(handednessConfidence * 100)}%</span>
            )}
          </p>
          {phases.map(phase => {
            const barColor =
              phase.score >= 78 ? 'bg-green-500'
              : phase.score >= 55 ? 'bg-yellow-500'
              : 'bg-red-500'
            return (
              <div key={phase.name} className="flex items-center gap-3">
                <span className="text-sm text-gray-300 w-36 shrink-0">{phase.name}</span>
                <div className="flex-1 bg-gray-700 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full ${barColor} transition-all duration-1000`}
                    style={{ width: `${phase.score}%` }}
                  />
                </div>
                <span className="text-sm font-bold text-white w-8 text-right">{phase.score}</span>
              </div>
            )
          })}
        </div>
      </div>

      {composite && (
        <div className="mt-8 pt-6 border-t border-gray-800 space-y-3">
          <h3 className="text-xs text-gray-400 uppercase tracking-wide mb-3">Score Breakdown</h3>
          <CompositeBar label="Joint Angles" score={composite.angles} weight={40} hint="elbow, knee, contact" />
          <CompositeBar label="Tempo" score={composite.tempo} weight={30} hint="timing between phases" />
          <CompositeBar label="Penalties" score={composite.penalties} weight={30} hint="missed elements" />
        </div>
      )}
    </div>
  )
}
