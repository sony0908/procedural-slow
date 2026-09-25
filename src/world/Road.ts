import * as THREE from 'three'

export const ROAD_WIDTH = 14
export const CHUNK_LENGTH = 300

// Deterministic low-frequency centerline — synthwave smooth curves
const SEED = 1337
export function roadCenterX(z: number): number {
  // combination of low freq sines for wide, driveable curves
  return Math.sin(z * 0.0030 + SEED * 0.001) * 42
       + Math.sin(z * 0.0011 + 1.7) * 24
       + Math.cos(z * 0.00062 + 0.9) * 18
       + Math.sin(z * 0.0055 + 2.3) * 5.5
}
export function roadCenterY(z: number): number {
  return Math.sin(z * 0.0019) * 2.4
       + Math.sin(z * 0.00085 + 1.2) * 1.1
       + Math.cos(z * 0.0045) * 0.6
}
export function roadCenter(z: number): THREE.Vector3 {
  return new THREE.Vector3(roadCenterX(z), roadCenterY(z), z)
}
export function roadTangent(z: number, eps = 1.5): THREE.Vector3 {
  const a = roadCenter(z - eps)
  const b = roadCenter(z + eps)
  return b.sub(a).normalize()
}
export function roadNormal(z: number): THREE.Vector3 {
  const t = roadTangent(z)
  // up 0,1,0 cross tangent -> horizontal normal
  const up = new THREE.Vector3(0, 1, 0)
  const n = new THREE.Vector3().crossVectors(t, up).normalize()
  // ensure consistent orientation: if flipped, invert
  // For road, we want lateral normal pointing left/right horizontally
  // t is roughly along Z, so n is along X
  // cross gives -X for t=+Z, so flip to get +X to the right
  n.multiplyScalar(-1)
  return n
}

// Build a CatmullRom curve segment for a chunk [z0, z1] with padding
export function buildCurve(z0: number, z1: number): THREE.CatmullRomCurve3 {
  const pad = 60
  const step = 22
  const pts: THREE.Vector3[] = []
  for (let z = z0 - pad; z <= z1 + pad; z += step) {
    pts.push(roadCenter(z))
  }
  // ensure include exact bounds
  if (pts[pts.length - 1].z < z1 + pad - 1e-3) pts.push(roadCenter(z1 + pad))
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35)
}

// Ribbon mesh geometry for road segment within chunk bounds using sampled centerline
export function buildRoadRibbon(z0: number, z1: number, width = ROAD_WIDTH, segments = 44): THREE.BufferGeometry {
  const length = z1 - z0
  const seg = segments
  const vertices: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  // sample along z, not curve param, but interpolate center
  for (let i = 0; i <= seg; i++) {
    const t = i / seg
    const z = THREE.MathUtils.lerp(z0, z1, t)
    const center = roadCenter(z)
    const n = roadNormal(z)
    const left = center.clone().addScaledVector(n, -width * 0.5)
    const right = center.clone().addScaledVector(n, width * 0.5)
    // two vertices per ring
    vertices.push(left.x, left.y + 0.02, left.z)
    vertices.push(right.x, right.y + 0.02, right.z)
    uvs.push(0, t * (length / 14))
    uvs.push(1, t * (length / 14))
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3
    // two triangles
    indices.push(a, c, b)
    indices.push(b, c, d)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

// Build neon edge tubes using TubeGeometry along offset curves
export function buildNeonTubes(curve: THREE.CatmullRomCurve3, width: number, z0: number, z1: number): { left: THREE.BufferGeometry, right: THREE.BufferGeometry } {
  // build offset curves by sampling and offsetting
  const ptsLeft: THREE.Vector3[] = []
  const ptsRight: THREE.Vector3[] = []
  const divs = 64
  for (let i = 0; i <= divs; i++) {
    const u = i / divs
    const p = curve.getPointAt(THREE.MathUtils.clamp(u, 0, 1))
    // need approximate z for normal; use p.z
    const n = roadNormal(p.z)
    ptsLeft.push(p.clone().addScaledVector(n, -width * 0.5).add(new THREE.Vector3(0, 0.06, 0)))
    ptsRight.push(p.clone().addScaledVector(n, width * 0.5).add(new THREE.Vector3(0, 0.06, 0)))
  }
  const cL = new THREE.CatmullRomCurve3(ptsLeft, false, 'catmullrom', 0.15)
  const cR = new THREE.CatmullRomCurve3(ptsRight, false, 'catmullrom', 0.15)
  const tubeL = new THREE.TubeGeometry(cL, 72, 0.16, 8, false)
  const tubeR = new THREE.TubeGeometry(cR, 72, 0.16, 8, false)
  return { left: tubeL, right: tubeR }
}
