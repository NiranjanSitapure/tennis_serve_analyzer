import { useRef, useState } from 'react'

export default function VideoUpload({ onVideoSelect, videoFile, videoUrl, onAnalyze }) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  function selectFile(file) {
    if (!file) return
    if (!file.type.startsWith('video/')) {
      setError('That doesn\'t look like a video file. Please choose an MP4, MOV, or other video format.')
      return
    }
    setError('')
    onVideoSelect(file)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    selectFile(e.dataTransfer.files[0])
  }

  function handleChange(e) {
    selectFile(e.target.files[0])
    e.target.value = ''
  }

  return (
    <div className="py-8">
      <div className="text-center mb-12">
        <h2 className="text-4xl font-bold text-white mb-4">Analyze Your Tennis Serve</h2>
        <p className="text-gray-400 text-lg max-w-xl mx-auto leading-relaxed">
          Upload a serve video and get instant AI-powered feedback on your stance, ball toss, trophy position, contact point, and follow-through.
        </p>
      </div>

      {!videoFile ? (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-20 text-center cursor-pointer transition-all duration-200
            ${dragging
              ? 'border-green-400 bg-green-400/10 scale-[1.01]'
              : 'border-gray-600 hover:border-gray-500 bg-gray-900 hover:bg-gray-800/70'
            }`}
        >
          <div className="text-6xl mb-5 select-none">🎾</div>
          <p className="text-white font-semibold text-xl mb-2">Drop your serve video here</p>
          <p className="text-gray-400 mb-5">or click to browse</p>
          <p className="text-gray-500 text-sm">
            MP4, MOV, AVI &nbsp;·&nbsp; Best results with a side-view recording showing your full body
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleChange}
          />
          {error && (
            <p className="text-red-400 text-sm mt-4">{error}</p>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="bg-gray-900 rounded-2xl overflow-hidden border border-gray-800">
            <video
              src={videoUrl}
              controls
              className="w-full max-h-72 object-contain bg-black"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div>
              <p className="text-white font-medium">{videoFile.name}</p>
              <p className="text-gray-500 text-sm">{(videoFile.size / (1024 * 1024)).toFixed(1)} MB</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-sm text-gray-400 hover:text-white border border-gray-600 hover:border-gray-400 px-4 py-2 rounded-lg transition-colors"
              >
                Change Video
              </button>
              <button
                onClick={onAnalyze}
                className="bg-green-600 hover:bg-green-500 active:bg-green-700 text-white font-semibold px-8 py-2 rounded-lg transition-colors"
              >
                Analyze Serve →
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleChange}
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-12">
        {[
          { icon: '🔒', title: 'Fully Private', desc: 'Video never leaves your browser — all analysis runs locally on your device' },
          { icon: '🤖', title: 'AI Pose Detection', desc: 'TensorFlow MoveNet detects 17 body keypoints across 6 key frames of your serve' },
          { icon: '🎯', title: '5 Phases Scored', desc: 'Stance, ball toss, trophy position, contact point, and follow-through' },
        ].map(({ icon, title, desc }) => (
          <div key={title} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
            <span className="text-3xl">{icon}</span>
            <h3 className="font-semibold text-white mt-3 mb-1">{title}</h3>
            <p className="text-gray-400 text-sm leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
