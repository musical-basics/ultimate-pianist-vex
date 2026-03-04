// components/score/VexFlowHelpers.ts
//
// Shared constants, types, and helper functions used by VexFlowRenderer.
// Keeps the renderer component lean and focused on layout + rendering.

import { StaveNote, Articulation } from 'vexflow'
import type { IntermediateNote } from '@/lib/score/IntermediateScore'

// ─── Layout Constants ──────────────────────────────────────────────

export const STAVE_WIDTH = 250         // px per measure
export const STAVE_Y_TREBLE = 40      // Y offset for treble stave
export const STAVE_SPACING = 120      // vertical space between treble and bass
export const LEFT_MARGIN = 20         // px left margin
export const SYSTEM_HEIGHT = 300      // total height for a grand staff system

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

// ─── Note Helpers ──────────────────────────────────────────────────

/**
 * Create a VexFlow StaveNote from an IntermediateNote.
 */
export function createStaveNote(note: IntermediateNote, staffIndex: number): StaveNote {
    const clef = staffIndex === 0 ? 'treble' : 'bass'

    return new StaveNote({
        keys: note.keys,
        duration: note.duration,
        clef,
        autoStem: true,
    })
}

/**
 * Check if a note duration is beamable (8th note or shorter).
 */
export function isBeamable(duration: string): boolean {
    const baseDur = duration.replace(/[rd]/g, '')
    return ['8', '16', '32', '64'].includes(baseDur)
}

/**
 * Create and attach an articulation modifier to a StaveNote.
 * VexFlow automatically positions articulations on the notehead side:
 *  - Below for stem-up notes, above for stem-down notes.
 */
export function addArticulation(staveNote: StaveNote, artCode: string): void {
    const art = new Articulation(artCode)
    // Let VexFlow auto-position based on stem direction (notehead side)
    staveNote.addModifier(art)
}
