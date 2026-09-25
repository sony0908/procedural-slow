import * as THREE from 'three'
import { createNoise2D } from '../core/Noise'
import { roadCenterX, CHUNK_LENGTH, ROAD_WIDTH } from './Road'

const noise = createNoise2D(4242)

export function buildTerrainChunk(z0: number, z1: number): THREE.BufferGeometry {
  // terrain covers wide area around road, with wireframe/low-poly look
  const TERRAIN_WIDTH = 520 // total width centered at road
  const segW = 38
  const segL = 28
  const length = z1 - z0
  const geom = new THREE.PlaneGeometry(TERRAIN_WIDTH, length, segW, segL)
  // PlaneGeometry is centered at origin, laid on XY plane. Rotate to XZ.
  // We'll manually fill positions to include world offset and noise elevation.
  const pos = geom.attributes.position as THREE.BufferAttribute
  const vertex = new THREE.Vector3()
  const cxMid = roadCenterX((z0 + z1) * 0.5)
  // we will interpret plane's x as world X offset from road center, y as Z offset
  for (let i = 0; i < pos.count; i++) {
    vertex.fromBufferAttribute(pos, i)
    // vertex.x in [-W/2, W/2], vertex.y in [-L/2, L/2]
    const localX = vertex.x
    const localZ = vertex.y
    const worldZ = (z0 + z1) * 0.5 + localZ
    const roadX = roadCenterX(worldZ)
    const worldX = roadX + localX // center terrain at road for each Z slice (to follow curve)
    // alternative: keep straight plane but roadX offset correct? Using per-vertex roadX follows curve
    // compute noise height
    // scale noise coordinates small to get mountains infrequent
    const nx = worldX * 0.006
    const nz = worldZ * 0.006
    let n = noise.noise(nx + 0.5, nz + 0.5) // 0..1
    // cubic elevation: valleys flat, peaks sharp (spec: y = pow(noise,3)*scale)
    const elevation = Math.pow(n, 3) * 92 // scale 92 units peak
    // falloff near road to keep track clear
    const distToRoad = Math.abs(worldX - roadX)
    const halfRoad = ROAD_WIDTH * 0.5
    const clear = halfRoad + 11 // fully flat
    const fadeEnd = halfRoad + 34
    let falloff = 1
    if (distToRoad < clear) falloff = 0
    else if (distToRoad < fadeEnd) {
      const t = (distToRoad - clear) / (fadeEnd - clear)
      falloff = t * t * (3 - 2 * t) // smoothstep
    }
    // also reduce elevation slightly with distance attenuation for far edges? keep peaks
    const h = elevation * falloff
    // small random detail for wireframe variation: add secondary noise tiny
    const detail = (noise.perlin2D(worldX * 0.02, worldZ * 0.02) * 0.5 + 0.5) * 1.2 * falloff
    const y = h + detail
    // store back: plane's Z will be world Y (height), need to reconstruct later
    // We'll set position.x = worldX, position.z = worldZ, position.y = y
    // Since PlaneGeometry vertices are (x, y, 0), after rotation they'd map. Easier: directly set.
    pos.setXYZ(i, worldX, 0, worldZ) // placeholder, will use separate H later via update
    // store y in separate array? Let's store height in a custom attribute and later apply.
    // Instead we will set y after loop via second pass using stored height array
    // For now stash y in a temporary property
    ;(pos as any)._heights = (pos as any)._heights || []
    ;(pos as any)._heights[i] = y
  }
  // now apply heights to Y channel and rotate fix? Plane was XY, we used X/Z; we need final world: x=worldX, y=height, z=worldZ
  // Our pos currently x=worldX, y=0, z=worldZ, but y should be height, z already correct.
  for (let i = 0; i < pos.count; i++) {
    const h = (pos as any)._heights[i]
    const x = pos.getX(i)
    const z = pos.getZ(i)
    pos.setXYZ(i, x, h, z)
  }
  delete (pos as any)._heights
  geom.computeVertexNormals()
  // add vertex colors for gradient (dark valley to magenta tint peak)
  const colors: number[] = []
  const color = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const n = Math.min(1, y / 55)
    // gradient: valley #0a0a1a -> mid #1a1a3a -> peak #402a5a with cyan tint
    if (n < 0.5) {
      color.setHSL(0.74 + n * 0.06, 0.55, 0.08 + n * 0.18)
    } else {
      color.setHSL(0.80 - (n - 0.5) * 0.12, 0.62, 0.17 + (n - 0.5) * 0.22)
    }
    colors.push(color.r, color.g, color.b)
  }
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  // centered already, no translation needed (world coords baked)
  return geom
}

export function createTerrainMaterial(): THREE.Material {
  // Spec: wireframe or flatShading with dark gradient and fluorescent edges
  // Use MeshStandardMaterial with wireframe true + vertexColors
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    wireframe: true,
    roughness: 0.95,
    metalness: 0.08,
    emissive: new THREE.Color(0x080818),
    emissiveIntensity: 0.25,
    flatShading: true,
    transparent: true,
    opacity: 0.98
  })
}

// Solid fill beneath wireframe to avoid see-through: optional second mesh with flat material low opacity
export function createTerrainFillMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    wireframe: false,
    roughness: 1,
    metalness: 0,
    flatShading: true,
    color: 0xffffff // vertex colors will tint
  })
}
