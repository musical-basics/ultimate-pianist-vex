/**
 * WaterfallRenderer — PixiJS Canvas + Zero-Allocation Render Loop
 */

import { Application, Graphics, Container } from 'pixi.js'
import type { NoteEvent, ParsedMidi } from '../types'
import { NotePool } from './NotePool'
import {
    calculatePianoMetricsFromDOM,
    calculatePianoMetrics,
    isBlackKey,
    MIDI_MIN,
    MIDI_MAX,
    type PianoMetrics,
} from './pianoMetrics'
import type { PlaybackManager } from './PlaybackManager'

const TRACK_COLORS: number[] = [
    0x22c55e, // Track 0: Green (right hand / treble)
    0x3b82f6, // Track 1: Blue (left hand / bass)
    0xf59e0b, // Track 2: Amber
    0xef4444, // Track 3: Red
    0xa855f7, // Track 4: Purple
]
const DEFAULT_COLOR = 0xa855f7

const ACTIVE_ALPHA = 0.95
const INACTIVE_ALPHA = 0.75

export class WaterfallRenderer {
    private app: Application | null = null
    private notePool: NotePool | null = null
    private playbackManager: PlaybackManager

    private canvasContainer: HTMLElement
    private resizeObserver: ResizeObserver | null = null

    private pixelsPerSecond = 200
    private strikeLineY = 0
    private canvasHeight = 0
    private canvasWidth = 0

    private keyX: Float64Array = new Float64Array(128)
    private keyW: Float64Array = new Float64Array(128)
    private keyValid: Uint8Array = new Uint8Array(128)

    private strikeLineGraphics: Graphics | null = null

    private keyElements: (HTMLElement | null)[] = new Array(128).fill(null)

    private activeThisFrame: Uint8Array = new Uint8Array(128)
    private activeLastFrame: Uint8Array = new Uint8Array(128)

    private notes: NoteEvent[] = []
    private leftHandActive = true
    private rightHandActive = true

    private boundRenderFrame: () => void

    private frameCount = 0
    private lastFpsTime = 0

    constructor(
        canvasContainer: HTMLElement,
        playbackManager: PlaybackManager
    ) {
        this.canvasContainer = canvasContainer
        this.playbackManager = playbackManager
        this.boundRenderFrame = this.renderFrame.bind(this)
    }

    async init(): Promise<void> {
        this.app = new Application()

        await this.app.init({
            preference: 'webgl',
            powerPreference: 'high-performance',
            antialias: false,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
            backgroundAlpha: 0,
            resizeTo: this.canvasContainer,
        })

        const canvas = this.app.canvas as HTMLCanvasElement
        canvas.style.position = 'absolute'
        canvas.style.top = '0'
        canvas.style.left = '0'
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        this.canvasContainer.appendChild(canvas)

        this.strikeLineGraphics = new Graphics()
        this.strikeLineGraphics.label = 'strike-line'
        this.app.stage.addChild(this.strikeLineGraphics)

        this.notePool = new NotePool(this.app, 1500)
        await this.notePool.init()

        this.cacheKeyElements()
        this.recalculateLayout()

        this.resizeObserver = new ResizeObserver(() => {
            this.recalculateLayout()
            this.cacheKeyElements()
        })
        this.resizeObserver.observe(this.canvasContainer)

        this.app.ticker.add(this.boundRenderFrame)

        console.log('[SynthUI] WaterfallRenderer initialized (zero-alloc render loop)')
    }

    private cacheKeyElements(): void {
        for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
            this.keyElements[pitch] = document.getElementById(`key-${pitch}`)
        }
    }

    private recalculateLayout(): void {
        if (!this.app) return

        const rect = this.canvasContainer.getBoundingClientRect()

        if (this.canvasWidth === rect.width && this.canvasHeight === rect.height) {
            return
        }

        this.canvasWidth = rect.width
        this.canvasHeight = rect.height
        this.strikeLineY = this.canvasHeight - 4

        const parent = this.canvasContainer.parentElement?.parentElement || this.canvasContainer
        const metrics =
            calculatePianoMetricsFromDOM(parent) ||
            calculatePianoMetrics(this.canvasWidth)

        this.keyValid.fill(0)
        for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
            const key = metrics.keys.get(pitch)
            if (key) {
                this.keyX[pitch] = key.x
                this.keyW[pitch] = key.width
                this.keyValid[pitch] = 1
            }
        }

        this.drawStrikeLine()
    }

    private drawStrikeLine(): void {
        if (!this.strikeLineGraphics) return
        this.strikeLineGraphics.clear()
        this.strikeLineGraphics.rect(0, this.strikeLineY - 1, this.canvasWidth, 2)
        this.strikeLineGraphics.fill({ color: 0xffffff, alpha: 0.15 })
        this.strikeLineGraphics.rect(0, this.strikeLineY - 3, this.canvasWidth, 6)
        this.strikeLineGraphics.fill({ color: 0xa855f7, alpha: 0.08 })
    }

    loadNotes(midi: ParsedMidi): void {
        this.notes = midi.notes
    }

    setTrackVisibility(leftHand: boolean, rightHand: boolean): void {
        this.leftHandActive = leftHand
        this.rightHandActive = rightHand
    }

    setZoom(pps: number): void {
        this.pixelsPerSecond = pps
    }

    private renderFrame(): void {
        if (!this.notePool || this.notes.length === 0) return

        const time = this.playbackManager.getVisualTime()
        const pps = this.pixelsPerSecond
        const strikeY = this.strikeLineY
        const canvasH = this.canvasHeight
        const lookaheadSec = canvasH / pps
        const notes = this.notes

        this.notePool.releaseAll()

        const temp = this.activeLastFrame
        this.activeLastFrame = this.activeThisFrame
        this.activeThisFrame = temp
        this.activeThisFrame.fill(0)

        const windowStart = time - 0.5
        const windowEnd = time + lookaheadSec

        const searchTime = Math.max(0, windowStart - 10.0)
        let lo = 0
        let hi = notes.length
        while (lo < hi) {
            const mid = (lo + hi) >>> 1
            if (notes[mid].startTimeSec < searchTime) {
                lo = mid + 1
            } else {
                hi = mid
            }
        }

        for (let i = lo; i < notes.length; i++) {
            const note = notes[i]
            if (note.startTimeSec > windowEnd) break
            if (note.endTimeSec < windowStart) continue
            if (!this.rightHandActive && note.trackId === 0) continue
            if (!this.leftHandActive && note.trackId === 1) continue
            if (!this.keyValid[note.pitch]) continue

            const timeUntilStart = note.startTimeSec - time
            const noteBottomY = strikeY - (timeUntilStart * pps)
            const noteHeight = note.durationSec * pps
            const noteTopY = noteBottomY - noteHeight

            if ((noteTopY + noteHeight) < 0 || noteTopY > canvasH) continue

            const sprite = this.notePool.acquire()
            if (!sprite) break

            sprite.x = Math.round(this.keyX[note.pitch])
            sprite.y = noteTopY

            const w = Math.round(this.keyW[note.pitch])
            const h = Math.max(Math.round(noteHeight), 12)
            if (Math.round(sprite.width) !== w) sprite.width = w
            if (Math.round(sprite.height) !== h) sprite.height = h

            const color = TRACK_COLORS[note.trackId] ?? DEFAULT_COLOR
            const active = time >= note.startTimeSec && time <= note.endTimeSec

            if (active) {
                this.activeThisFrame[note.pitch] = 1
                sprite.tint = color
                sprite.alpha = ACTIVE_ALPHA
                sprite.x -= 1
                sprite.width += 2
            } else {
                sprite.tint = color
                sprite.alpha = INACTIVE_ALPHA
            }
        }

        for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
            const wasActive = this.activeLastFrame[pitch]
            const isActive = this.activeThisFrame[pitch]

            if (wasActive && !isActive) {
                const el = this.keyElements[pitch]
                if (el) el.dataset.active = 'false'
            } else if (!wasActive && isActive) {
                const el = this.keyElements[pitch]
                if (el) el.dataset.active = 'true'
            }
        }

        this.frameCount++
        const now = performance.now()
        if (now - this.lastFpsTime >= 2000) {
            this.frameCount = 0
            this.lastFpsTime = now
        }
    }

    destroy(): void {
        if (this.app) {
            this.app.ticker.remove(this.boundRenderFrame)
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect()
            this.resizeObserver = null
        }

        for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
            const el = this.keyElements[pitch]
            if (el) el.dataset.active = 'false'
        }

        if (this.notePool) {
            this.notePool.destroy()
            this.notePool = null
        }

        if (this.app) {
            const canvas = this.app.canvas
            this.app.destroy(true, { children: true, texture: true })
            if (canvas?.parentElement) {
                canvas.parentElement.removeChild(canvas)
            }
            this.app = null
        }

        this.strikeLineGraphics = null
        this.keyElements.fill(null)

        console.log('[SynthUI] WaterfallRenderer destroyed')
    }
}
