/**
 * NotePool — Object Pool for PixiJS Sprites (Zero GC)
 */

import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js'
import type { Application } from 'pixi.js'

export class NotePool {
    private pool: Sprite[] = []
    private activeCount = 0
    private container: Container
    private noteTexture: RenderTexture | null = null

    constructor(
        private app: Application,
        private poolSize: number = 1500
    ) {
        this.container = new Container()
        this.container.label = 'note-pool'
        this.app.stage.addChild(this.container)
    }

    async init(): Promise<void> {
        this.noteTexture = this.bakeNoteTexture()
        for (let i = 0; i < this.poolSize; i++) {
            const sprite = new Sprite(this.noteTexture)
            sprite.visible = false
            sprite.label = `note-${i}`
            this.container.addChild(sprite)
            this.pool.push(sprite)
        }
        console.log(`[SynthUI] NotePool initialized: ${this.poolSize} sprites pre-allocated`)
    }

    private bakeNoteTexture(): RenderTexture {
        const width = 64
        const height = 64
        const radius = 6

        const g = new Graphics()
        g.roundRect(0, 0, width, height, radius)
        g.fill({ color: 0xFFFFFF, alpha: 0.9 })
        g.roundRect(1, 1, width - 2, height * 0.4, radius)
        g.fill({ color: 0xFFFFFF, alpha: 0.3 })
        g.roundRect(1, height * 0.7, width - 2, height * 0.28, radius)
        g.fill({ color: 0x000000, alpha: 0.15 })
        g.roundRect(0.5, 0.5, width - 1, height - 1, radius)
        g.stroke({ color: 0xFFFFFF, width: 0.5, alpha: 0.2 })

        const texture = RenderTexture.create({ width, height })
        this.app.renderer.render({ container: g, target: texture })
        g.destroy()

        return texture
    }

    acquire(): Sprite | null {
        if (this.activeCount >= this.poolSize) return null
        const sprite = this.pool[this.activeCount]
        sprite.visible = true
        this.activeCount++
        return sprite
    }

    releaseAll(): void {
        for (let i = 0; i < this.activeCount; i++) {
            this.pool[i].visible = false
        }
        this.activeCount = 0
    }

    getContainer(): Container {
        return this.container
    }

    destroy(): void {
        this.container.destroy({ children: true })
        if (this.noteTexture) {
            this.noteTexture.destroy(true)
            this.noteTexture = null
        }
    }
}
