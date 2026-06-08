const PHASE_LABELS = ['Stance', 'Ball Toss', 'Trophy Position', 'Backswing', 'Contact', 'Follow-Through']
const TIMESTAMPS = [0.10, 0.25, 0.40, 0.55, 0.70, 0.85]

const LOAD_TIMEOUT_MS = 30000
const SEEK_TIMEOUT_MS = 10000

export function extractFrames(videoFile) {
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

    // Wait for loadeddata (not just loadedmetadata) so the first frame is decoded
    // and videoWidth/videoHeight are reliable — Safari reports 0 at metadata time.
    video.addEventListener('loadeddata', async () => {
      try {
        const duration = video.duration

        // Streams / corrupt files can report Infinity or NaN, which would slip
        // past a plain `< 1` check and produce invalid seek targets.
        if (!isFinite(duration) || duration < 1) {
          fail('Video is too short or has no fixed length. Please upload a recorded clip of at least 1 second.')
          return
        }

        const frames = []

        for (let i = 0; i < TIMESTAMPS.length; i++) {
          if (settled) return
          await seekTo(video, TIMESTAMPS[i] * duration)
          await waitForFrame(video)

          const width = video.videoWidth || 640
          const height = video.videoHeight || 360

          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          canvas.getContext('2d').drawImage(video, 0, 0, width, height)

          frames.push({
            canvas,
            dataUrl: canvas.toDataURL('image/jpeg', 0.85),
            timestamp: TIMESTAMPS[i] * duration,
            label: PHASE_LABELS[i],
            width,
            height,
          })
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

// Seek and resolve once the frame at `time` is available, rejecting if the
// browser never fires `seeked` (corrupt / non-seekable media).
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

// Ensure a real frame is painted before we read pixels. requestVideoFrameCallback
// is the precise signal where supported; otherwise fall back to the next paint.
function waitForFrame(video) {
  return new Promise(resolve => {
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => resolve())
    } else {
      requestAnimationFrame(() => resolve())
    }
  })
}
