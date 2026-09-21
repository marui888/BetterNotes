import { useEffect, useRef } from 'react'
import videojs from 'video.js'
import 'video.js/dist/video-js.css'

export default function VideoPlayer({
  src,
  subtitle,
  subtitleEnabled = true,
  playbackRate = 1,
  volume = 1,
  onReady,
  onTimeUpdate,
  onEnded,
  onPlaybackRateChange,
  onVolumeChange,
}) {
  const videoRef = useRef(null)
  const playerRef = useRef(null)
  const remoteTextTrackRef = useRef(null)
  const subtitleEnabledRef = useRef(subtitleEnabled)
  const onReadyRef = useRef(onReady)
  const onTimeUpdateRef = useRef(onTimeUpdate)
  const onEndedRef = useRef(onEnded)
  const playbackRateRef = useRef(playbackRate)
  const volumeRef = useRef(volume)
  const onPlaybackRateChangeRef = useRef(onPlaybackRateChange)
  const onVolumeChangeRef = useRef(onVolumeChange)
  const sourceLoadingRef = useRef(false)

  useEffect(() => {
    onReadyRef.current = onReady
    onTimeUpdateRef.current = onTimeUpdate
    onEndedRef.current = onEnded
    onPlaybackRateChangeRef.current = onPlaybackRateChange
    onVolumeChangeRef.current = onVolumeChange
    subtitleEnabledRef.current = subtitleEnabled
  }, [onReady, onTimeUpdate, onEnded, onPlaybackRateChange, onVolumeChange])

  useEffect(() => {
    playbackRateRef.current = Number.isFinite(Number(playbackRate)) ? Number(playbackRate) : 1
    volumeRef.current = Number.isFinite(Number(volume)) ? Math.max(0, Math.min(1, Number(volume))) : 1
  }, [playbackRate, volume])

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
    player.on('ratechange', () => {
      const nextRate = Number(player.playbackRate?.()) || 1
      const expectedRate = playbackRateRef.current
      if (sourceLoadingRef.current && Math.abs(nextRate - expectedRate) > 0.001) {
        player.playbackRate?.(expectedRate)
        return
      }
      onPlaybackRateChangeRef.current?.(nextRate)
    })
    player.on('volumechange', () => {
      const nextVolume = Number(player.volume?.())
      const expectedVolume = volumeRef.current
      if (sourceLoadingRef.current && Number.isFinite(nextVolume) && Math.abs(nextVolume - expectedVolume) > 0.001) {
        player.volume?.(expectedVolume)
        return
      }
      onVolumeChangeRef.current?.(Number.isFinite(nextVolume) ? nextVolume : 1)
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
    if (!player) {
      return undefined
    }

    if (!src) {
      sourceLoadingRef.current = true
      player.pause?.()
      if (remoteTextTrackRef.current) {
        player.removeRemoteTextTrack(remoteTextTrackRef.current.track || remoteTextTrackRef.current)
        remoteTextTrackRef.current = null
      }
      player.reset?.()
      player.playbackRate?.(playbackRateRef.current)
      player.volume?.(volumeRef.current)
      sourceLoadingRef.current = false
      return undefined
    }

    let correctionTimeoutId = 0
    let fallbackTimeoutId = 0
    const applyPlayingView = () => {
      player.playbackRate?.(playbackRateRef.current)
      player.volume?.(volumeRef.current)
    }
    const finishSourceLoad = () => {
      applyPlayingView()
      sourceLoadingRef.current = false
    }

    sourceLoadingRef.current = true
    player.one?.('loadedmetadata', finishSourceLoad)
    player.src({ src, type: 'video/mp4' })
    player.load()
    applyPlayingView()
    correctionTimeoutId = window.setTimeout(applyPlayingView, 180)
    fallbackTimeoutId = window.setTimeout(finishSourceLoad, 5000)
    return () => {
      window.clearTimeout(correctionTimeoutId)
      window.clearTimeout(fallbackTimeoutId)
      player.off?.('loadedmetadata', finishSourceLoad)
      sourceLoadingRef.current = false
    }
  }, [src])

  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    if (Math.abs(Number(player.playbackRate?.()) - playbackRateRef.current) > 0.001) {
      player.playbackRate?.(playbackRateRef.current)
    }
    if (Math.abs(Number(player.volume?.()) - volumeRef.current) > 0.001) {
      player.volume?.(volumeRef.current)
    }
  }, [playbackRate, volume])

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
