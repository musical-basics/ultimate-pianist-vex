'use client'

/**
 * SplitScreenLayout — Top: Sheet Music (ScrollView), Bottom: Waterfall + Piano
 * Accepts isAdmin prop to show/hide editing controls.
 */

import * as React from 'react'
import { useRef, useEffect, useState, useCallback } from 'react'
import {
    ResizablePanelGroup,
    ResizablePanel,
    ResizableHandle,
} from '@/components/ui/resizable'
import { ScrollView } from '@/components/score/ScrollView'
import { PianoKeyboard } from '@/components/synthesia/PianoKeyboard'
import { useAppStore } from '@/lib/store'
import { getPlaybackManager, destroyPlaybackManager } from '@/lib/engine/PlaybackManager'
import { AudioSynth } from '@/lib/engine/AudioSynth'
import type { WaterfallRenderer } from '@/lib/engine/WaterfallRenderer'
import type { ParsedMidi } from '@/lib/types'

interface SplitScreenLayoutProps {
    /** Audio URL for the master WAV clock */
    audioUrl: string | null
    /** MusicXML URL for sheet music rendering */
    xmlUrl: string | null
    /** Parsed MIDI data for the waterfall */
    parsedMidi: ParsedMidi | null
    /** Whether this is the admin (editor) view or user (playback) view */
    isAdmin?: boolean
    /** Children to render in the header area (e.g., toolbar) */
    children?: React.ReactNode
}

export const SplitScreenLayout: React.FC<SplitScreenLayoutProps> = ({
    audioUrl,
    xmlUrl,
    parsedMidi,
    isAdmin = false,
    children,
}) => {
    // ─── Store ──────────────────────────────────────────────────────
    const isPlaying = useAppStore((s) => s.isPlaying)
    const anchors = useAppStore((s) => s.anchors)
    const beatAnchors = useAppStore((s) => s.beatAnchors)
    const darkMode = useAppStore((s) => s.darkMode)
    const revealMode = useAppStore((s) => s.revealMode)
    const highlightNote = useAppStore((s) => s.highlightNote)
    const glowEffect = useAppStore((s) => s.glowEffect)
    const popEffect = useAppStore((s) => s.popEffect)
    const isLocked = useAppStore((s) => s.isLocked)
    const cursorPosition = useAppStore((s) => s.cursorPosition)
    const showCursor = useAppStore((s) => s.showCursor)
    const setCurrentMeasure = useAppStore((s) => s.setCurrentMeasure)

    // ─── Refs ───────────────────────────────────────────────────────
    const waterfallContainerRef = useRef<HTMLDivElement>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const audioSynthRef = useRef<AudioSynth | null>(null)
    const rendererRef = useRef<WaterfallRenderer | null>(null)
    const [rendererReady, setRendererReady] = useState(false)

    // ─── Audio Element Setup ────────────────────────────────────────
    useEffect(() => {
        if (!audioUrl) return

        const audio = new Audio(audioUrl)
        audio.crossOrigin = 'anonymous'
        audioRef.current = audio

        // Set as master clock in PlaybackManager
        const pm = getPlaybackManager()
        pm.setAudioElement(audio)

        // Set duration when metadata loads
        audio.addEventListener('loadedmetadata', () => {
            pm.duration = audio.duration
        })

        return () => {
            audio.pause()
            pm.setAudioElement(null)
            audioRef.current = null
        }
    }, [audioUrl])

    // ─── WaterfallRenderer Init ─────────────────────────────────────
    useEffect(() => {
        let isCancelled = false
        let localRenderer: WaterfallRenderer | null = null

        const init = async () => {
            const container = waterfallContainerRef.current
            if (!container) return

            try {
                const { WaterfallRenderer: WR } = await import('@/lib/engine/WaterfallRenderer')
                if (isCancelled) return

                const pm = getPlaybackManager()
                localRenderer = new WR(container, pm)
                await localRenderer.init()

                if (isCancelled) {
                    localRenderer.destroy()
                    return
                }

                rendererRef.current = localRenderer
                setRendererReady(true)
            } catch (err) {
                console.error('[SplitScreen] Renderer init failed:', err)
            }
        }

        init()

        return () => {
            isCancelled = true
            if (rendererRef.current) {
                rendererRef.current.destroy()
                rendererRef.current = null
            } else if (localRenderer) {
                localRenderer.destroy()
            }
            setRendererReady(false)
        }
    }, [])

    // ─── Load MIDI into renderer ────────────────────────────────────
    useEffect(() => {
        if (parsedMidi && rendererRef.current) {
            rendererRef.current.loadNotes(parsedMidi)
        }
    }, [parsedMidi, rendererReady])

    // ─── Sync AudioSynth mute when WAV is active ────────────────────
    useEffect(() => {
        if (audioSynthRef.current) {
            audioSynthRef.current.masterAudioActive = !!audioUrl
        }
    }, [audioUrl])

    // ─── Cleanup ────────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            audioSynthRef.current?.destroy()
            audioSynthRef.current = null
        }
    }, [])

    const handleMeasureChange = useCallback((measure: number) => {
        setCurrentMeasure(measure)
    }, [setCurrentMeasure])

    return (
        <div className="flex flex-col h-full w-full overflow-hidden bg-zinc-950">
            {/* Optional header/toolbar */}
            {children}

            {/* Split layout */}
            <ResizablePanelGroup direction="vertical" className="flex-1">
                {/* Top: Sheet Music */}
                <ResizablePanel defaultSize={45} minSize={20} maxSize={80}>
                    <ScrollView
                        xmlUrl={xmlUrl}
                        anchors={anchors}
                        beatAnchors={beatAnchors}
                        isPlaying={isPlaying}
                        isAdmin={isAdmin}
                        darkMode={darkMode}
                        revealMode={revealMode}
                        highlightNote={highlightNote}
                        glowEffect={glowEffect}
                        popEffect={popEffect}
                        isLocked={isLocked}
                        cursorPosition={cursorPosition}
                        showCursor={showCursor}
                        onMeasureChange={handleMeasureChange}
                    />
                </ResizablePanel>

                <ResizableHandle
                    withHandle
                    className="bg-zinc-700 h-2 data-[resize-handle-state=hover]:bg-purple-500 data-[resize-handle-state=drag]:bg-purple-500 transition-colors [&>div]:bg-zinc-600 [&>div]:h-5 [&>div]:w-8 [&>div]:rounded-full [&>div]:border-zinc-500"
                />

                {/* Bottom: Waterfall + Piano */}
                <ResizablePanel defaultSize={55} minSize={20} maxSize={80}>
                    <div className="flex flex-col h-full">
                        {/* Waterfall canvas */}
                        <div className="flex-1 relative bg-black/50">
                            <div
                                ref={waterfallContainerRef}
                                className="relative w-full h-full"
                            >
                                {!rendererReady && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="text-center space-y-2 opacity-30">
                                            <div className="w-10 h-10 mx-auto rounded-full border-2 border-dashed border-zinc-600 flex items-center justify-center">
                                                <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                                            </div>
                                            <p className="text-zinc-600 text-xs">Initializing...</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Piano Keyboard */}
                        <PianoKeyboard />
                    </div>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    )
}

export default SplitScreenLayout
