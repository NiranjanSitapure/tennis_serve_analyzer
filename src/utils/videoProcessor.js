const TARGET_FPS = 10        // sample rate across the whole clip
const MIN_FRAMES = 8         // never extract fewer than this
const MAX_FRAMES = 20        // MoveNet is fast; 20 frames at 10 FPS = 2 s window, plenty for phase detection
const EXTRACT_MAX_DIM = 512  // MoveNet resizes input to 256px anyway

const LOAD_TIMEOUT_MS = 30000
const SEEK_TIMEOUT_MS = 10000

// Build the sample timestamps. Walk the clip end-to-end at ~10 FPS, but if the
// clip is short (<1.5s) fall back to MIN_FRAMES uniformly spaced; if it's long
// (>6s) cap at MAX_FRAMES still uniformly spaced. Phase detection picks the 5
// scoring frames from this dense sequence downstream.
function buildTimestamps(duration) {
  const naiveCount = Math.round(duration * TARGET_FPS)
  const count = Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, naiveCount))
  const stamps = []
  // Sample uniformly in (0, duration), avoiding the very first/last 5%.
  const start = duration * 0.05
  const end = duration * 0.95
  const span = end - start
  for (let i = 0; i < count; i++) {
    stamps.push(start + (span * i) / (count - 1))
  }
  return stamps
}

export function extractFrames(videoFile, onProgress) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'

    const url = URL.createObjectURL(videoFile)
    let settled = false

    const cleanup = () => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
    }
    const fail = (message) => {
      if (settled) return
      settled = true
      clearTimeout(loadTimer)
      cleanup()
      reject(new Error(message))
    }
    const succeed = (frames) => {
      if (settled) return
      settled = true
      clearTimeout(loadTimer)
      cleanup()
      resolve(frames)
    }

    const loadTimer = setTimeout(
      () => fail('Video took too long to load. Please try a shorter clip or a different format (MP4 recommended).'),
      LOAD_TIMEOUT_MS,
    )

    video.addEventListener('error', () =>
      fail('Could not load video. Please try a different file format (MP4 recommended).'))

    video.addEventListener('loadeddata', async () => {
      // Timer's only job is catching videos that never load. Clear it now so
      // it doesn't fire during extraction (seeks are guarded by their own 10s timeout).
      clearTimeout(loadTimer)
      try {
        const duration = video.duration

        if (!isFinite(duration) || duration < 1) {
          fail('Video is too short or has no fixed length. Please upload a recorded clip of at least 1 second.')
          return
        }

        const timestamps = buildTimestamps(duration)
        const frames = []

        for (let i = 0; i < timestamps.length; i++) {
          if (settled) return
          await seekTo(video, timestamps[i])
          await waitForFrame(video)

          const rawW = video.videoWidth || 640
          const rawH = video.videoHeight || 360
          const scale = Math.min(1, EXTRACT_MAX_DIM / Math.max(rawW, rawH))
          const width = Math.round(rawW * scale)
          const height = Math.round(rawH * scale)

          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          canvas.getContext('2d').drawImage(video, 0, 0, width, height)

          frames.push({
            canvas,
            // dataUrl is only generated for the 5 phase frames downstream (much
            // cheaper); skip the JPEG encode here for the bulk frames.
            timestamp: video.currentTime,
            width,
            height,
          })

          if (onProgress) onProgress(i + 1, timestamps.length)
        }

        succeed(frames)
      } catch (err) {
        fail(err.message || 'Failed while extracting frames from the video.')
      }
    }, { once: true })

    video.src = url
    video.load()
  })
}

// Render a frame's canvas to a JPEG data URL. Called only for the 5 phase
// frames after phase detection — encoding all ~30 frames is wasted work.
export function frameToDataUrl(frame) {
  if (!frame || !frame.canvas) return null
  return frame.canvas.toDataURL('image/jpeg', 0.85)
}

function seekTo(video, time) {
  return new Promise((resolve, reject) => {
    let timer
    const onSeeked = () => {
      clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }
    timer = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked)
      reject(new Error('Timed out seeking within the video — it may be corrupt or use an unsupported codec.'))
    }, SEEK_TIMEOUT_MS)
    video.addEventListener('seeked', onSeeked)
    // fastSeek jumps to the nearest keyframe — much faster on Safari/Firefox.
    // We record video.currentTime after seeked fires, so the actual landed
    // timestamp is used throughout; precision doesn't matter here.
    if (typeof video.fastSeek === 'function') {
      video.fastSeek(time)
    } else {
      video.currentTime = time
    }
  })
}

function waitForFrame(video) {
  return new Promise(resolve => {
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => resolve())
    } else {
      requestAnimationFrame(() => resolve())
    }
  })
}
