import { useEffect, useRef } from 'react'
import videojs from 'video.js'
import 'video.js/dist/video-js.css'

export default function VideoPlayer({ src, subtitle, subtitleEnabled = true, onReady, onTimeUpdate, onEnded }) {
  const videoRef = useRef(null)
  const playerRef = useRef(null)
  const remoteTextTrackRef = useRef(null)
  const subtitleEnabledRef = useRef(subtitleEnabled)
  const onReadyRef = useRef(onReady)
  const onTimeUpdateRef = useRef(onTimeUpdate)
  const onEndedRef = useRef(onEnded)

  useEffect(() => {
    onReadyRef.current = onReady
    onTimeUpdateRef.current = onTimeUpdate
    onEndedRef.current = onEnded
    subtitleEnabledRef.current = subtitleEnabled
  }, [onReady, onTimeUpdate, onEnded])

  useEffect(() => {
    subtitleEnabledRef.current = subtitleEnabled
  }, [subtitleEnabled])

  useEffect(() => {
    if (!videoRef.current || playerRef.current) {
      return undefined
    }

    const player = videojs(videoRef.current, {
      controls: true,
      preload: 'auto',
      fluid: false,
      fill: true,
      playbackRates: [0.1, 0.3, 0.5, 0.8, 0.9, 1, 1.2, 1.4, 1.6, 1.8, 2],
    })

    playerRef.current = player
    player.on('timeupdate', () => {
      onTimeUpdateRef.current?.(player.currentTime())
    })
    player.on('ended', () => {
      onEndedRef.current?.()
    })
    onReadyRef.current?.(player)

    return () => {
      if (remoteTextTrackRef.current) {
        player.removeRemoteTextTrack(remoteTextTrackRef.current.track || remoteTextTrackRef.current)
        remoteTextTrackRef.current = null
      }
      player.dispose()
      playerRef.current = null
    }
  }, [])

  useEffect(() => {
    const player = playerRef.current
    if (!player || !src) {
      return
    }

    player.src({ src, type: 'video/mp4' })
    player.load()
  }, [src])

  useEffect(() => {
    const player = playerRef.current
    if (!player) {
      return
    }

    if (remoteTextTrackRef.current) {
      player.removeRemoteTextTrack(remoteTextTrackRef.current.track || remoteTextTrackRef.current)
      remoteTextTrackRef.current = null
    }

    if (subtitle?.fileUrl) {
      remoteTextTrackRef.current = player.addRemoteTextTrack({
        kind: 'subtitles',
        src: subtitle.fileUrl,
        srclang: subtitle.language || 'und',
        label: subtitle.label || subtitle.fileName || 'Subtitle',
        default: true,
      }, false)

      const track = remoteTextTrackRef.current?.track
      if (track) {
        track.mode = subtitleEnabledRef.current ? 'showing' : 'disabled'
      }
    }
  }, [subtitle])

  useEffect(() => {
    const track = remoteTextTrackRef.current?.track
    if (!track) return

    track.mode = subtitleEnabled ? 'showing' : 'disabled'
  }, [subtitleEnabled])

  return (
    <div className="video-js-host">
      <video
        className="video-js vjs-default-skin vjs-big-play-centered"
        playsInline
        ref={videoRef}
      />
    </div>
  )
}
