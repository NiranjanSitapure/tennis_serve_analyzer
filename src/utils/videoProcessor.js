const PHASE_LABELS = ['Stance', 'Ball Toss', 'Trophy Position', 'Backswing', 'Contact', 'Follow-Through']
const TIMESTAMPS = [0.10, 0.25, 0.40, 0.55, 0.70, 0.85]

export function extractFrames(videoFile) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true

    const url = URL.createObjectURL(videoFile)
    video.src = url

    video.addEventListener('loadedmetadata', async () => {
      const duration = video.duration

      if (duration < 1) {
        URL.revokeObjectURL(url)
        reject(new Error('Video is too short. Please upload a video of at least 1 second.'))
        return
      }

      const frames = []

      for (let i = 0; i < TIMESTAMPS.length; i++) {
        const timestamp = TIMESTAMPS[i] * duration

        await new Promise(res => {
          video.currentTime = timestamp
          video.addEventListener('seeked', res, { once: true })
        })

        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 640
        canvas.height = video.videoHeight || 360

        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        frames.push({
          canvas,
          dataUrl: canvas.toDataURL('image/jpeg', 0.85),
          timestamp,
          label: PHASE_LABELS[i],
          width: canvas.width,
          height: canvas.height,
        })
      }

      URL.revokeObjectURL(url)
      resolve(frames)
    })

    video.addEventListener('error', () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not load video. Please try a different file format (MP4 recommended).'))
    })

    video.load()
  })
}
