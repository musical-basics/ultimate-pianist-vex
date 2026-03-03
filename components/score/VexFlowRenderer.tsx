'use client'

// components/score/VexFlowRenderer.tsx
//
// Renders an IntermediateScore using VexFlow's SVG backend.
// Produces: measureXMap, beatXMap, noteMap, systemYMap via onRenderComplete.
// Does NOT touch xmlEvents — that comes from OsmdParser.

import * as React from 'react'
import { useRef, useEffect, useCallback, useState } from 'react'
import {
    Renderer,
    Stave,
    StaveNote,
    Voice,
    Formatter,
    Beam,
    StaveTie,
    Accidental,
    Articulation,
    Dot,
    StaveConnector,
    type RenderContext,
    VoiceMode,
} from 'vexflow'
import type { IntermediateScore, IntermediateNote } from '@/lib/score/IntermediateScore'

// ─── Types ─────────────────────────────────────────────────────────

export type NoteData = {
    id: string
    measureIndex: number
    timestamp: number
    element: HTMLElement | null
    stemElement: HTMLElement | null
}

export interface VexFlowRenderResult {
    measureXMap: Map<number, number>
    beatXMap: Map<number, Map<number, number>>
    noteMap: Map<number, NoteData[]>
    systemYMap: { top: number; height: number }
    measureCount: number
}

interface VexFlowRendererProps {
    score: IntermediateScore | null
    onRenderComplete?: (result: VexFlowRenderResult) => void
    darkMode?: boolean
}

// ─── Constants ─────────────────────────────────────────────────────

const STAVE_WIDTH = 250           // px per measure
const STAVE_Y_TREBLE = 40        // Y offset for treble stave
const STAVE_SPACING = 80         // vertical space between treble and bass
const LEFT_MARGIN = 20           // px left margin
const SYSTEM_HEIGHT = 260        // total height for a grand staff system

// ─── Component ─────────────────────────────────────────────────────

const VexFlowRendererComponent: React.FC<VexFlowRendererProps> = ({
    score,
    onRenderComplete,
    darkMode = false,
}) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const rendererRef = useRef<Renderer | null>(null)
    const [isRendered, setIsRendered] = useState(false)

    const renderScore = useCallback(() => {
        if (!score || !containerRef.current || score.measures.length === 0) return

        // Clear previous render
        containerRef.current.innerHTML = ''
        setIsRendered(false)

        const measures = score.measures
        const totalWidth = LEFT_MARGIN + (measures.length * STAVE_WIDTH) + 40

        // Create SVG renderer
        const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG)
        renderer.resize(totalWidth, SYSTEM_HEIGHT)
        rendererRef.current = renderer

        const context = renderer.getContext() as RenderContext

        // Track state for rendering
        const measureXMap = new Map<number, number>()
        const beatXMap = new Map<number, Map<number, number>>()
        const allNoteData = new Map<number, NoteData[]>()

        // Track current clefs
        let currentTrebleClef = 'treble'
        let currentBassClef = 'bass'
        let currentKeySig = 'C'
        let currentTimeSigNum = 4
        let currentTimeSigDen = 4

        // Track previous measure's last notes for ties
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prevMeasureLastNotes: Map<string, { staveNote: any; keyIndex: number }> = new Map()

        // Store tie data for cross-measure ties
        interface TieRequest {
            firstNote: StaveNote
            lastNote: StaveNote
            firstIndices: number[]
            lastIndices: number[]
        }
        const tieRequests: TieRequest[] = []

        // Render each measure
        for (let mIdx = 0; mIdx < measures.length; mIdx++) {
            const measure = measures[mIdx]
            const measureNumber = measure.measureNumber
            const x = LEFT_MARGIN + (mIdx * STAVE_WIDTH)

            // Update running state
            if (measure.keySignature) currentKeySig = measure.keySignature
            if (measure.timeSignatureNumerator) currentTimeSigNum = measure.timeSignatureNumerator
            if (measure.timeSignatureDenominator) currentTimeSigDen = measure.timeSignatureDenominator

            // ── Create staves ──
            const trebleStave = new Stave(x, STAVE_Y_TREBLE, STAVE_WIDTH)
            const bassStave = new Stave(x, STAVE_Y_TREBLE + STAVE_SPACING, STAVE_WIDTH)

            // Clefs
            for (const staff of measure.staves) {
                if (staff.staffIndex === 0 && staff.clef) {
                    currentTrebleClef = staff.clef
                }
                if (staff.staffIndex === 1 && staff.clef) {
                    currentBassClef = staff.clef
                }
            }

            if (mIdx === 0) {
                trebleStave.addClef(currentTrebleClef)
                bassStave.addClef(currentBassClef)

                if (currentKeySig && currentKeySig !== 'C' && currentKeySig !== 'Am') {
                    trebleStave.addKeySignature(currentKeySig)
                    bassStave.addKeySignature(currentKeySig)
                }

                trebleStave.addTimeSignature(`${currentTimeSigNum}/${currentTimeSigDen}`)
                bassStave.addTimeSignature(`${currentTimeSigNum}/${currentTimeSigDen}`)
            } else {
                // Only add if changed
                if (measure.staves[0]?.clef) trebleStave.addClef(currentTrebleClef)
                if (measure.staves[1]?.clef) bassStave.addClef(currentBassClef)

                if (measure.keySignature) {
                    if (currentKeySig !== 'C' && currentKeySig !== 'Am') {
                        trebleStave.addKeySignature(currentKeySig)
                        bassStave.addKeySignature(currentKeySig)
                    }
                }

                if (measure.timeSignatureNumerator) {
                    trebleStave.addTimeSignature(`${currentTimeSigNum}/${currentTimeSigDen}`)
                    bassStave.addTimeSignature(`${currentTimeSigNum}/${currentTimeSigDen}`)
                }
            }

            trebleStave.setContext(context).draw()
            bassStave.setContext(context).draw()

            // Brace + line connector on first measure
            if (mIdx === 0) {
                new StaveConnector(trebleStave, bassStave).setType('brace').setContext(context).draw()
                new StaveConnector(trebleStave, bassStave).setType('singleLeft').setContext(context).draw()
            }
            // End barline connector
            new StaveConnector(trebleStave, bassStave).setType('singleRight').setContext(context).draw()

            // Record measure X position
            measureXMap.set(measureNumber, trebleStave.getX() + trebleStave.getNoteStartX() - trebleStave.getX())

            // ── Create notes for each staff ──
            const staveMap: { [staffIdx: number]: Stave } = {
                0: trebleStave,
                1: bassStave,
            }

            const measureNoteData: NoteData[] = []
            const measureBeatPositions = new Map<number, number>()

            // Track notes that need ties from this measure
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const currentMeasureFirstNotes: Map<string, { staveNote: any; keyIndex: number }> = new Map()

            for (const staff of measure.staves) {
                const stave = staveMap[staff.staffIndex]
                if (!stave) continue

                for (const voice of staff.voices) {
                    if (voice.notes.length === 0) continue

                    // Build StaveNotes
                    const vfNotes: StaveNote[] = []
                    const beamableNotes: StaveNote[] = []

                    for (const note of voice.notes) {
                        const staveNote = createStaveNote(note, staff.staffIndex)

                        // Apply accidentals
                        for (let ki = 0; ki < note.accidentals.length; ki++) {
                            const acc = note.accidentals[ki]
                            if (acc) {
                                staveNote.addModifier(new Accidental(acc), ki)
                            }
                        }

                        // Apply dots
                        if (note.dots > 0) {
                            Dot.buildAndAttach([staveNote], { all: true })
                        }

                        // Apply articulations
                        for (const artCode of note.articulations) {
                            staveNote.addModifier(new Articulation(artCode))
                        }

                        // Set the custom ID for DOM mapping
                        staveNote.setAttribute('id', note.vfId)

                        vfNotes.push(staveNote)

                        // Collect beamable notes (8th and shorter, not rests)
                        if (!note.isRest && isBeamable(note.duration)) {
                            beamableNotes.push(staveNote)
                        }

                        // Track for ties — current measure first notes by key
                        if (!note.isRest) {
                            for (let ki = 0; ki < note.keys.length; ki++) {
                                const tieKey = `${staff.staffIndex}-${note.keys[ki]}`
                                if (!currentMeasureFirstNotes.has(tieKey)) {
                                    currentMeasureFirstNotes.set(tieKey, { staveNote, keyIndex: ki })
                                }
                            }

                            // Check for cross-measure ties from previous measure
                            for (let ki = 0; ki < note.keys.length; ki++) {
                                const tieKey = `${staff.staffIndex}-${note.keys[ki]}`
                                const prev = prevMeasureLastNotes.get(tieKey)
                                if (prev) {
                                    tieRequests.push({
                                        firstNote: prev.staveNote,
                                        lastNote: staveNote,
                                        firstIndices: [prev.keyIndex],
                                        lastIndices: [ki],
                                    })
                                    prevMeasureLastNotes.delete(tieKey)
                                }
                            }
                        }

                        // Track tie-to-next for this note
                        if (!note.isRest) {
                            for (let ki = 0; ki < note.tiesToNext.length; ki++) {
                                if (note.tiesToNext[ki]) {
                                    const tieKey = `${staff.staffIndex}-${note.keys[ki]}`
                                    prevMeasureLastNotes.set(tieKey, { staveNote, keyIndex: ki })
                                }
                            }
                        }
                    }

                    // Create Voice
                    const vfVoice = new Voice({
                        numBeats: currentTimeSigNum,
                        beatValue: currentTimeSigDen,
                    }).setMode(VoiceMode.SOFT)

                    vfVoice.addTickables(vfNotes)

                    // Format
                    new Formatter().joinVoices([vfVoice]).format([vfVoice], STAVE_WIDTH - 40)

                    // Draw
                    vfVoice.draw(context, stave)

                    // Beaming — generate beams for groups of beamable notes
                    if (beamableNotes.length >= 2) {
                        try {
                            const beams = Beam.generateBeams(beamableNotes)
                            beams.forEach(beam => beam.setContext(context).draw())
                        } catch {
                            // Beaming may fail for unusual note groupings — skip silently
                        }
                    }

                    // Within-measure ties
                    for (let ni = 0; ni < voice.notes.length - 1; ni++) {
                        const note = voice.notes[ni]
                        if (note.isRest) continue
                        for (let ki = 0; ki < note.tiesToNext.length; ki++) {
                            if (note.tiesToNext[ki] && ni + 1 < vfNotes.length) {
                                // Check if next note is in the same measure
                                const nextNote = voice.notes[ni + 1]
                                if (nextNote && !nextNote.isRest) {
                                    // Find matching key index in next note
                                    const matchIdx = nextNote.keys.indexOf(note.keys[ki])
                                    if (matchIdx >= 0) {
                                        tieRequests.push({
                                            firstNote: vfNotes[ni],
                                            lastNote: vfNotes[ni + 1],
                                            firstIndices: [ki],
                                            lastIndices: [matchIdx],
                                        })
                                        // Remove from cross-measure tracking since it was resolved within measure
                                        const tieKey = `${staff.staffIndex}-${note.keys[ki]}`
                                        prevMeasureLastNotes.delete(tieKey)
                                    }
                                }
                            }
                        }
                    }

                    // Collect beat positions and note data from rendered notes
                    for (let ni = 0; ni < voice.notes.length; ni++) {
                        const intNote = voice.notes[ni]
                        const vfNote = vfNotes[ni]

                        if (!intNote.isRest) {
                            try {
                                const noteX = vfNote.getAbsoluteX()
                                measureBeatPositions.set(intNote.beat, noteX)
                            } catch { /* some notes may not have position yet */ }
                        }

                        // Build NoteData for DOM effects
                        if (!intNote.isRest) {
                            measureNoteData.push({
                                id: intNote.vfId,
                                measureIndex: measureNumber,
                                timestamp: (intNote.beat - 1) / currentTimeSigNum,
                                element: null, // will be populated after DOM is ready
                                stemElement: null,
                            })
                        }
                    }
                }
            }

            beatXMap.set(measureNumber, measureBeatPositions)
            allNoteData.set(measureNumber, measureNoteData)
        }

        // Draw all ties
        for (const tie of tieRequests) {
            try {
                new StaveTie({
                    firstNote: tie.firstNote,
                    lastNote: tie.lastNote,
                    firstIndexes: tie.firstIndices,
                    lastIndexes: tie.lastIndices,
                }).setContext(context).draw()
            } catch {
                // Tie rendering may fail if notes are malformed — skip
            }
        }

        // ── Post-render: populate DOM element references ──
        requestAnimationFrame(() => {
            if (!containerRef.current) return

            // Populate noteMap element references
            allNoteData.forEach((notes) => {
                for (const note of notes) {
                    const el = containerRef.current?.querySelector(`[id="${note.id}"]`) as HTMLElement
                    if (el) {
                        const group = el.closest('.vf-stavenote') as HTMLElement || el
                        group.querySelectorAll('path, rect').forEach(p => {
                            const pathEl = p as HTMLElement
                            pathEl.style.transformBox = 'fill-box'
                            pathEl.style.transformOrigin = 'center'
                            pathEl.style.transition = 'transform 0.1s ease-out, fill 0.1s, stroke 0.1s'
                        })
                        note.element = group
                    }
                }
            })

            setIsRendered(true)

            // Fire callback with all rendering data
            if (onRenderComplete) {
                const systemYMap = {
                    top: STAVE_Y_TREBLE - 20,
                    height: SYSTEM_HEIGHT,
                }

                onRenderComplete({
                    measureXMap,
                    beatXMap,
                    noteMap: allNoteData,
                    systemYMap,
                    measureCount: measures.length,
                })
            }
        })

    }, [score, onRenderComplete])

    // Render when score changes
    useEffect(() => {
        renderScore()
    }, [renderScore])

    // Handle resize
    useEffect(() => {
        const handleResize = () => setTimeout(() => renderScore(), 500)
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [renderScore])

    return (
        <div
            ref={containerRef}
            className="vexflow-container"
            style={{
                minWidth: '100%',
                minHeight: `${SYSTEM_HEIGHT}px`,
                opacity: isRendered ? 1 : 0,
                transition: 'opacity 0.2s',
            }}
        />
    )
}

// ─── Helpers ───────────────────────────────────────────────────────

function createStaveNote(note: IntermediateNote, staffIndex: number): StaveNote {
    const clef = staffIndex === 0 ? 'treble' : 'bass'

    return new StaveNote({
        keys: note.keys,
        duration: note.duration,
        clef,
        autoStem: true,
    })
}

function isBeamable(duration: string): boolean {
    // Beamable if 8th note or shorter (strip rest/dot suffixes)
    const baseDur = duration.replace(/[rd]/g, '')
    return ['8', '16', '32', '64'].includes(baseDur)
}

export const VexFlowRenderer = React.memo(VexFlowRendererComponent)
export default VexFlowRenderer
