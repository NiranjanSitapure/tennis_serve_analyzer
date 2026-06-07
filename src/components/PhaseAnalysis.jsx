import { useState } from 'react'

const TIPS = {
  'Stance': 'Stand near the baseline with feet shoulder-width apart. Angle your body so your non-dominant shoulder points toward the target. Weight on your back foot at the start.',
  'Ball Toss': 'Hold the ball in your fingertips, not your palm. Raise your tossing arm slowly and release the ball at the peak of your arm extension — slightly in front of and above your head.',
  'Trophy Position': 'As you toss, bend your serving elbow and raise it above shoulder level. Bend your knees to load energy. This coiled position is called the "trophy" because it resembles holding a trophy.',
  'Contact Point': 'Explode upward from your knee bend, reach as high as possible, and strike the ball with a fully extended arm at the peak of your jump or reach. Pronate your forearm through contact.',
  'Follow-Through': 'After contact, let the racket swing naturally across your body — it should finish near your opposite hip or thigh. Never stop the swing early; a complete follow-through prevents injury and improves control.',
}

const CONFIG = {
  good:     { icon: '✓', textColor: 'text-green-400',  borderColor: 'border-green-500/30',  bg: 'bg-green-900/20'  },
  needs_work:{ icon: '⚠', textColor: 'text-yellow-400', borderColor: 'border-yellow-500/30', bg: 'bg-yellow-900/20' },
  poor:     { icon: '✗', textColor: 'text-red-400',    borderColor: 'border-red-500/30',    bg: 'bg-red-900/20'    },
  uncertain:{ icon: '?', textColor: 'text-gray-400',   borderColor: 'border-gray-600/40',   bg: 'bg-gray-800/30'   },
}

function PhaseCard({ phase }) {
  const [open, setOpen] = useState(true)
  const cfg = CONFIG[phase.status] || CONFIG.uncertain

  return (
    <div className={`rounded-xl border ${cfg.borderColor} ${cfg.bg} overflow-hidden`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-5 text-left"
      >
        <div className="flex items-center gap-3">
          <span className={`text-lg font-bold ${cfg.textColor}`}>{cfg.icon}</span>
          <span className="font-semibold text-white">{phase.name}</span>
          <span className={`text-sm font-bold ${cfg.textColor}`}>{phase.score}/100</span>
        </div>
        <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Analysis</p>
            <ul className="space-y-1.5">
              {phase.feedback.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-200">
                  <span className={`${cfg.textColor} mt-0.5 shrink-0`}>•</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          {TIPS[phase.name] && (
            <div className="bg-gray-800/60 rounded-lg p-4 border border-gray-700/50">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Pro Tip</p>
              <p className="text-sm text-gray-300 leading-relaxed">{TIPS[phase.name]}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function PhaseAnalysis({ phases }) {
  if (!phases || phases.length === 0) return null

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">Phase-by-Phase Breakdown</h2>
      <div className="space-y-3">
        {phases.map(phase => (
          <PhaseCard key={phase.name} phase={phase} />
        ))}
      </div>

      <p className="text-xs text-gray-600 text-center mt-6">
        Analysis is based on AI pose estimation of body keypoints. Results may vary with video quality and camera angle.
      </p>
    </div>
  )
}
