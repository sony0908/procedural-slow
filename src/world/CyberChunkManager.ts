import * as THREE from 'three'
import { CHUNK_LENGTH } from './Road'
import { CyberChunk } from './CyberChunk'

export class CyberChunkManager {
  private chunks = new Map<number, CyberChunk>()
  private scene: THREE.Scene
  // visible window: keep 5 chunks [current-1, current+3] (behind + ahead)
  private readonly keepBehind = 1
  private readonly keepAhead = 3
  private readonly extraAhead = 1 // generate one beyond visible for seamless

  constructor(scene: THREE.Scene) { this.scene = scene }

  update(progressZ: number) {
    const cur = Math.floor(progressZ / CHUNK_LENGTH)
    const minKeep = cur - this.keepBehind
    const maxKeep = cur + this.keepAhead + this.extraAhead // inclusive generate
    const minVisible = cur - this.keepBehind
    const maxVisible = cur + this.keepAhead

    // generate needed [minKeep, maxKeep]
    for (let i = minKeep; i <= maxKeep; i++) {
      if (!this.chunks.has(i)) {
        const chunk = new CyberChunk(i)
        this.chunks.set(i, chunk)
        this.scene.add(chunk.group)
      }
    }
    // dispose out of visible + buffer (keep 1 extra behind/ahead beyond maxKeep)
    for (const [idx, chunk] of this.chunks) {
      if (idx < minKeep || idx > maxKeep) {
        chunk.dispose(this.scene)
        this.chunks.delete(idx)
      }
    }
    // optional: we could hide generation via fog – already scene.fog handles
  }

  getStats() {
    return { loaded: this.chunks.size, active: this.chunks.size }
  }

  // For minimap sampling center line
  getActiveRange(): [number, number] {
    if (this.chunks.size === 0) return [0,0]
    const keys = [...this.chunks.keys()].sort((a,b)=>a-b)
    return [keys[0], keys[keys.length-1]]
  }
}
