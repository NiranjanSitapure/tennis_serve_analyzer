const TARGET_FPS = 10        // sample rate across the whole clip
const MIN_FRAMES = 8         // never extract fewer than this
const MAX_FRAMES = 20        // MoveNet is fast; 20 frames is plenty for phase detection
const EXTRACT_MAX_DIM = 512  // MoveNet resizes input to 256px anyway

const LOAD_TIMEOUT_MS = 30000
const SEEK_TIMEOUT_MS = 8000
const FRAME_WAIT_MS = 150    // hard cap on waiting for a decoded frame — never hang

// Build the sample timestamps. Walk the clip end-to-end at ~10 FPS, capped at
// MAX_FRAMES, with at least MIN_FRAMES. Phase detection picks the 5 scoring
// frames from this dense sequence downstream.
function buildTimestamps(duration) {
  const naiveCount = Math.round(duration * TARGET_FPS)
  const count = Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, naiveCount))
  const stamps = []
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

    // Attach the element offscreen so the browser reliably decodes and
    // composites frames after each seek. A detached <video> can refuse to
    // produce frames for drawImage in some browsers — that was a hang source.
    video.style.position = 'fixed'
    video.style.left = '-10000px'
    video.style.top = '0'
    video.style.width = '1px'
    video.style.height = '1px'
    video.style.opacity = '0'
    video.style.pointerEvents = 'none'
    document.body.appendChild(video)

    const url = URL.createObjectURL(videoFile)
    let settled = false

    const cleanup = () => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
      if (video.parentNode) video.parentNode.removeChild(video)
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
      // Timer's only job is catching videos that never load. Clear it now so it
      // doesn't fire during extraction (each seek has its own timeout).
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
            // dataUrl is generated only for the 5 phase frames downstream.
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
// frames after phase detection — encoding all frames would be wasted work.
export function frameToDataUrl(frame) {
  if (!frame || !frame.canvas) return null
  return frame.canvas.toDataURL('image/jpeg', 0.85)
}

// Seek to an exact time. We use video.currentTime (NOT fastSeek): fastSeek
// snaps to the nearest keyframe, and when consecutive targets share a keyframe
// the time doesn't change and the 'seeked' event never fires — a hang source.
// Exact seeking to distinct timestamps always advances currentTime, so
// 'seeked' fires every time.
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
    video.currentTime = time
  })
}

// Give the browser a moment to paint the seeked frame before drawImage. Uses
// requestVideoFrameCallback when available, but ALWAYS resolves within
// FRAME_WAIT_MS so it can never hang — even on a video that produces no
// callback (the previous version waited forever).
function waitForFrame(video) {
  return new Promise(resolve => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => finish())
    }
    setTimeout(finish, FRAME_WAIT_MS)
  })
}
