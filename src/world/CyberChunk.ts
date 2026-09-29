import * as THREE from 'three'
import { buildRoadRibbon, buildCurve, CHUNK_LENGTH, ROAD_WIDTH, roadCenter } from './Road'
import { buildTerrainChunk, createTerrainMaterial } from './Terrain'

export class CyberChunk {
  readonly index: number
  readonly z0: number
  readonly z1: number
  readonly group: THREE.Group
  private meshes: THREE.Mesh[] = []
  private geos: THREE.BufferGeometry[] = []

  constructor(index: number) {
    this.index = index
    this.z0 = index * CHUNK_LENGTH
    this.z1 = this.z0 + CHUNK_LENGTH
    this.group = new THREE.Group()
    this.group.name = `chunk_${index}`
    this.build()
  }

  private build() {
    // 1) Road ribbon (asphalt) — aclarado para no verse negro
    const roadGeo = buildRoadRibbon(this.z0, this.z1, ROAD_WIDTH, 48)
    this.geos.push(roadGeo)
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x1c1c2a,
      roughness: 0.38,
      metalness: 0.28,
      emissive: new THREE.Color(0x0a0a1e),
      emissiveIntensity: 0.22
    })
    const roadMesh = new THREE.Mesh(roadGeo, roadMat)
    roadMesh.receiveShadow = false
    this.group.add(roadMesh); this.meshes.push(roadMesh)

    // subtle center dashed? add thin central line (optional) – not needed
    // 2) Neon edges via TubeGeometry derived from curve
    const curve = buildCurve(this.z0, this.z1)
    // clip tubes to chunk length: sampling via curve but tube will extend with padding, we keep as is and fog will hide
    // Instead build tubes directly offset and clipped
    const tubeMatLeft = new THREE.MeshStandardMaterial({
      color: 0xff0055,
      emissive: new THREE.Color(0xff0055),
      emissiveIntensity: 3.2,
      roughness: 0.4,
      metalness: 0.1,
      transparent: false
    })
    const tubeMatRight = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      emissive: new THREE.Color(0x00ffff),
      emissiveIntensity: 3.4,
      roughness: 0.4,
      metalness: 0.1
    })
    // Build neon tubes via manual extrusion per segment (avoid TubeGeometry artifacts with sharp curve)
    // Use strip-like tubes: create thin boxes along road edges sampled
    const leftGeo = this.buildEdgeStrip(this.z0, this.z1, -ROAD_WIDTH * 0.5)
    const rightGeo = this.buildEdgeStrip(this.z0, this.z1, ROAD_WIDTH * 0.5)
    this.geos.push(leftGeo, rightGeo)
    const leftMesh = new THREE.Mesh(leftGeo, tubeMatLeft)
    const rightMesh = new THREE.Mesh(rightGeo, tubeMatRight)
    this.group.add(leftMesh); this.group.add(rightMesh)
    this.meshes.push(leftMesh, rightMesh)

    // 3) Terrain wireframe on sides
    const terrainGeo = buildTerrainChunk(this.z0, this.z1)
    this.geos.push(terrainGeo)
    const terrainMat = createTerrainMaterial()
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat)
    terrainMesh.frustumCulled = false
    this.group.add(terrainMesh); this.meshes.push(terrainMesh)

    // 4) Ground fill under road for neon glow
    const underGeo = this.buildUnderGlow(this.z0, this.z1)
    const underMat = new THREE.MeshStandardMaterial({
      color: 0x020208,
      roughness: 1,
      metalness: 0,
      emissive: new THREE.Color(0x0a0a1a),
      emissiveIntensity: 0.6
    })
    const under = new THREE.Mesh(underGeo, underMat)
    this.geos.push(underGeo)
    this.group.add(under); this.meshes.push(under as any)

    // 5) Optional grid lines on terrain for synthwave: already wireframe
  }

  private buildEdgeStrip(z0: number, z1: number, lateral: number): THREE.BufferGeometry {
    const segs = 48
    const thickness = 0.14
    const height = 0.08
    const verts: number[] = []
    const idx: number[] = []
    // Use road tangent/normal extruded thin box
    const up = new THREE.Vector3(0, 1, 0)
    // Pre-sample centers
    const centers: THREE.Vector3[] = []
    const normals: THREE.Vector3[] = []
    const tangents: THREE.Vector3[] = []
    for (let i = 0; i <= segs; i++) {
      const z = THREE.MathUtils.lerp(z0, z1, i / segs)
      const c = roadCenter(z)
      const t = new THREE.Vector3().subVectors(roadCenter(z + 0.1), roadCenter(z - 0.1)).normalize()
      const n = new THREE.Vector3().crossVectors(t, up).normalize().multiplyScalar(-1)
      const pos = c.clone().addScaledVector(n, lateral)
      pos.y += 0.07 // slight lift
      centers.push(pos)
      normals.push(n)
      tangents.push(t)
    }
    // build quad strip with thickness (extrude normal * thickness and up * height)
    // For each center, create two vertices: inner and outer shifted along normal slightly? Actually neon tube is thin line, so just a flat ribbon with thickness
    // Simpler: create 4 vertices per segment? Let's create a thin box: for each i, we add 2 vertices offset along normal by thickness/2 and y
    for (let i = 0; i <= segs; i++) {
      const c = centers[i]
      const n = normals[i]
      const half = thickness * 0.5
      const p1 = c.clone().addScaledVector(n, -half)
      const p2 = c.clone().addScaledVector(n, half)
      verts.push(p1.x, p1.y, p1.z)
      verts.push(p2.x, p2.y, p2.z)
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3
      idx.push(a, c, b)
      idx.push(b, c, d)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    return geo
  }

  private buildUnderGlow(z0: number, z1: number): THREE.BufferGeometry {
    const segs = 12
    const extra = 22
    const verts: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= segs; i++) {
      const z = THREE.MathUtils.lerp(z0 - 5, z1 + 5, i / segs)
      const c = roadCenter(z)
      const t = new THREE.Vector3().subVectors(roadCenter(z + 0.5), roadCenter(z - 0.5)).normalize()
      const n = new THREE.Vector3().crossVectors(t, new THREE.Vector3(0,1,0)).normalize().multiplyScalar(-1)
      const l = c.clone().addScaledVector(n, -(ROAD_WIDTH*0.5 + extra))
      const r = c.clone().addScaledVector(n, ROAD_WIDTH*0.5 + extra)
      l.y -= 0.35; r.y -= 0.35
      verts.push(l.x, l.y, l.z)
      verts.push(r.x, r.y, r.z)
    }
    for (let i = 0; i < segs; i++) {
      const a = i*2, b=a+1, c=a+2, d=a+3
      idx.push(a,c,b); idx.push(b,c,d)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts,3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    return geo
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group)
    for (const g of this.geos) g.dispose()
    for (const m of this.meshes) {
      const mat = (m as any).material as THREE.Material | THREE.Material[]
      if (Array.isArray(mat)) mat.forEach(mm=>mm.dispose())
      else mat.dispose()
    }
  }
}
