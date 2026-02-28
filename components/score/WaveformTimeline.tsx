'use client'

/**
 * WaveformTimeline — Displays audio waveform with draggable anchor points
 */

import * as React from 'react'
import { useRef, useEffect, useCallback, useState } from 'react'
import { getPlaybackManager } from '@/lib/engine/PlaybackManager'
import type { Anchor, BeatAnchor } from '@/lib/types'

interface WaveformTimelineProps {
    audioUrl: string | null
    anchors: Anchor[]
    beatAnchors?: BeatAnchor[]
    isPlaying: boolean
    duration: number
    onSeek: (time: number) => void
    onAnchorDrag?: (measure: number, newTime: number) => void
    darkMode?: boolean
}

const ANCHOR_HIT_RADIUS = 6 // px tolerance for clicking on an anchor line

export const WaveformTimeline: React.FC<WaveformTimelineProps> = ({
    audioUrl,
    anchors,
    beatAnchors = [],
    isPlaying,
    duration,
    onSeek,
    onAnchorDrag,
    darkMode = false,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const audioDataRef = useRef<Float32Array | null>(null)
    const rafRef = useRef<number>(0)
    const [isLoaded, setIsLoaded] = useState(false)
    const cursorTimeRef = useRef<number>(0)

    // Drag state (refs for performance — no re-renders during drag)
    const draggingRef = useRef<{ measure: number; time: number } | null>(null)
    const isDraggingRef = useRef(false)

    // Load audio data for waveform visualization
    useEffect(() => {
        if (!audioUrl) return

        const loadAudio = async () => {
            try {
                const response = await fetch(audioUrl)
                const buffer = await response.arrayBuffer()
                const ctx = new AudioContext()
                const decoded = await ctx.decodeAudioData(buffer)
                const channelData = decoded.getChannelData(0)

                // Downsample for visualization
                const samples = 2000
                const step = Math.floor(channelData.length / samples)
                const downsampled = new Float32Array(samples)
                for (let i = 0; i < samples; i++) {
                    let max = 0
                    for (let j = 0; j < step; j++) {
                        const idx = i * step + j
                        if (idx < channelData.length) {
                            max = Math.max(max, Math.abs(channelData[idx]))
                        }
                    }
                    downsampled[i] = max
                }

                audioDataRef.current = downsampled
                setIsLoaded(true)
                ctx.close()
            } catch (err) {
                console.error('[Waveform] Failed to load audio:', err)
            }
        }

        loadAudio()
    }, [audioUrl])

    // Draw waveform + cursor + anchors on canvas
    const drawFrame = useCallback((cursorTime: number, dragOverride?: { measure: number; time: number }) => {
        const canvas = canvasRef.current
        const data = audioDataRef.current
        if (!canvas) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const { width, height } = canvas
        ctx.clearRect(0, 0, width, height)

        // Background
        ctx.fillStyle = darkMode ? '#18181b' : '#f4f4f5'
        ctx.fillRect(0, 0, width, height)

        // Waveform bars
        if (data) {
            const barWidth = width / data.length
            ctx.fillStyle = darkMode ? '#4b5563' : '#a1a1aa'

            for (let i = 0; i < data.length; i++) {
                const barHeight = data[i] * height * 0.8
                const x = i * barWidth
                const y = (height - barHeight) / 2
                ctx.fillRect(x, y, Math.max(barWidth - 0.5, 0.5), barHeight)
            }
        }

        // Anchor markers
        if (duration > 0) {
            for (const anchor of anchors) {
                // If we're dragging this anchor, use the drag position instead
                const displayTime = (dragOverride && dragOverride.measure === anchor.measure)
                    ? dragOverride.time
                    : anchor.time
                const x = (displayTime / duration) * width
                const isDragged = dragOverride && dragOverride.measure === anchor.measure

                // Line
                ctx.strokeStyle = isDragged ? '#f59e0b' : '#8b5cf6' // yellow when dragging
                ctx.lineWidth = isDragged ? 3 : 2
                ctx.beginPath()
                ctx.moveTo(x, 0)
                ctx.lineTo(x, height)
                ctx.stroke()

                // Measure number label
                ctx.fillStyle = isDragged ? '#f59e0b' : '#8b5cf6'
                ctx.font = isDragged ? 'bold 11px monospace' : '10px monospace'
                ctx.fillText(`M${anchor.measure}`, x + 3, 12)

                // Show time when dragging
                if (isDragged) {
                    ctx.fillStyle = '#f59e0b'
                    ctx.font = '10px monospace'
                    ctx.fillText(`${displayTime.toFixed(2)}s`, x + 3, height - 4)
                }
            }
        }

        // Cursor line (always drawn)
        if (duration > 0) {
            const x = (cursorTime / duration) * width
            ctx.strokeStyle = '#ec4899'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(x, 0)
            ctx.lineTo(x, height)
            ctx.stroke()

            // Time label
            const m = Math.floor(cursorTime / 60)
            const s = Math.floor(cursorTime % 60)
            ctx.fillStyle = '#ec4899'
            ctx.font = '10px monospace'
            ctx.fillText(`${m}:${s.toString().padStart(2, '0')}`, x + 3, height - 4)
        }
    }, [darkMode, anchors, duration])

    // Redraw when anchors, dark mode, or loaded state changes
    useEffect(() => {
        if (isLoaded) drawFrame(cursorTimeRef.current)
    }, [isLoaded, drawFrame])

    // Continuous animation loop — runs during playback, one-shot when paused
    useEffect(() => {
        if (!isLoaded) return

        const animate = () => {
            const pm = getPlaybackManager()
            const time = pm.getTime()
            cursorTimeRef.current = time
            drawFrame(time)
            rafRef.current = requestAnimationFrame(animate)
        }

        if (isPlaying) {
            rafRef.current = requestAnimationFrame(animate)
        } else {
            drawFrame(cursorTimeRef.current)
        }

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
        }
    }, [isPlaying, isLoaded, drawFrame])

    // ─── Hit test: find anchor near a pixel X position ─────────────
    const findAnchorAtX = useCallback((clientX: number): Anchor | null => {
        const canvas = canvasRef.current
        if (!canvas || !duration) return null

        const rect = canvas.getBoundingClientRect()
        const pixelX = clientX - rect.left

        for (const anchor of anchors) {
            const anchorPixelX = (anchor.time / duration) * rect.width
            if (Math.abs(pixelX - anchorPixelX) <= ANCHOR_HIT_RADIUS) {
                return anchor
            }
        }
        return null
    }, [anchors, duration])

    // ─── Mouse handlers for drag ───────────────────────────────────
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const anchor = findAnchorAtX(e.clientX)
        if (anchor && onAnchorDrag) {
            // Start dragging this anchor
            e.preventDefault()
            isDraggingRef.current = true
            draggingRef.current = { measure: anchor.measure, time: anchor.time }

            const canvas = canvasRef.current!
            canvas.style.cursor = 'grabbing'
        }
    }, [findAnchorAtX, onAnchorDrag])

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current
        if (!canvas || !duration) return

        if (isDraggingRef.current && draggingRef.current) {
            // Update drag position
            const rect = canvas.getBoundingClientRect()
            const x = e.clientX - rect.left
            const newTime = Math.max(0, Math.min(duration, (x / rect.width) * duration))
            draggingRef.current = { ...draggingRef.current, time: newTime }
            drawFrame(cursorTimeRef.current, draggingRef.current)
        } else {
            // Hover cursor: show grab cursor when hovering over an anchor
            const anchor = findAnchorAtX(e.clientX)
            canvas.style.cursor = anchor && onAnchorDrag ? 'grab' : 'pointer'
        }
    }, [duration, drawFrame, findAnchorAtX, onAnchorDrag])

    const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current
        if (!canvas) return

        if (isDraggingRef.current && draggingRef.current) {
            // Commit the drag
            const { measure, time } = draggingRef.current
            onAnchorDrag?.(measure, time)
            console.log(`[Waveform] Dragged M${measure} → ${time.toFixed(2)}s`)

            isDraggingRef.current = false
            draggingRef.current = null
            canvas.style.cursor = 'pointer'
            return // Don't also seek when completing a drag
        }

        // Normal click → seek
        if (!duration) return
        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const time = (x / rect.width) * duration
        cursorTimeRef.current = time
        onSeek(time)
        drawFrame(time)
    }, [duration, onAnchorDrag, onSeek, drawFrame])

    const handleMouseLeave = useCallback(() => {
        // Cancel drag if mouse leaves canvas
        if (isDraggingRef.current) {
            isDraggingRef.current = false
            draggingRef.current = null
            if (canvasRef.current) canvasRef.current.style.cursor = 'pointer'
            drawFrame(cursorTimeRef.current)
        }
    }, [drawFrame])

    // Resize canvas
    useEffect(() => {
        const container = containerRef.current
        const canvas = canvasRef.current
        if (!container || !canvas) return

        const observer = new ResizeObserver(() => {
            canvas.width = container.clientWidth * window.devicePixelRatio
            canvas.height = container.clientHeight * window.devicePixelRatio
            canvas.style.width = `${container.clientWidth}px`
            canvas.style.height = `${container.clientHeight}px`
            if (isLoaded) drawFrame(cursorTimeRef.current)
        })

        observer.observe(container)
        return () => observer.disconnect()
    }, [isLoaded, drawFrame])

    return (
        <div
            ref={containerRef}
            className={`relative w-full h-16 ${darkMode ? 'bg-zinc-900' : 'bg-zinc-100'} rounded-md overflow-hidden`}
        >
            <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                className="w-full h-full cursor-pointer"
            />
            {!audioUrl && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <p className={`text-xs ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        No audio loaded
                    </p>
                </div>
            )}
        </div>
    )
}

export default WaveformTimeline
