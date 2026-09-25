import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { CyberChunkManager } from './world/CyberChunkManager'
import { VehicleController } from './core/VehicleController'
import { CameraRig } from './core/CameraRig'
import { roadCenter } from './world/Road'

// ——— DOM ———
const canvas = document.getElementById('game') as HTMLCanvasElement
const overlay = document.getElementById('overlay')!
const enterBtn = document.getElementById('enter')!
const speedValEl = document.getElementById('speedVal')!
const fpsEl = document.getElementById('fpsHud')!
const minimap = document.getElementById('minimap') as HTMLCanvasElement
const mctx = minimap.getContext('2d')!
const noticeEl = document.getElementById('notice')!

function showNotice(t: string, ms = 2400) {
  noticeEl.textContent = t
  noticeEl.classList.add('show')
  setTimeout(()=> noticeEl.classList.remove('show'), ms)
}

// ——— Renderer / Scene ———
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.15
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
renderer.setClearColor(0x020208, 1)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x020208)
scene.fog = new THREE.FogExp2(0x020208, 0.008) // spec: 0x020208 0.008

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 1400)
camera.position.set(0, 5, -12)

scene.add(new THREE.HemisphereLight(0x9ab7ff, 0x080818, 0.9))
const sun = new THREE.DirectionalLight(0xfff2d6, 2.0); sun.position.set(-40, 60, -20); scene.add(sun)
const neonFill = new THREE.PointLight(0x00ffff, 22, 30); neonFill.position.set(0, 4, 0); scene.add(neonFill)
scene.add(new THREE.AmbientLight(0x1a1a2a, 0.35))

// ——— Stars (partículas pequeñas inmóviles lejanas) ———
function createStars() {
  const count = 2800
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(count * 3)
  const col = new Float32Array(count * 3)
  const size = new Float32Array(count)
  const c = new THREE.Color()
  for (let i = 0; i < count; i++) {
    // sphere distribution radius 700..1100
    const r = 720 + Math.random() * 420
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    // shift stars above horizon, slightly flattened
    const x = r * Math.sin(phi) * Math.cos(theta)
    const y = r * Math.cos(phi) * 0.55 + 180
    const z = r * Math.sin(phi) * Math.sin(theta)
    // keep stars not below terrain horizon mostly
    pos[i * 3 + 0] = x
    pos[i * 3 + 1] = Math.max(28, y + (Math.random() - 0.5) * 40)
    pos[i * 3 + 2] = z
    // color slight cyan/magenta variation
    const tint = Math.random()
    if (tint < 0.68) c.setHSL(0.55 + Math.random() * 0.04, 0.18, 0.92)
    else if (tint < 0.84) c.setHSL(0.82, 0.22, 0.9)
    else c.setHSL(0.06, 0.2, 0.94)
    col[i * 3 + 0] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
    size[i] = 0.7 + Math.random() * 1.1
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const mat = new THREE.PointsMaterial({
    size: 1.35,
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  scene.add(points)
  return points
}
const stars = createStars()

// add distant synthwave mountains silhouette via large low-poly plane far?
// We'll just rely on fog + terrain chunks extending to horizon, plus a large horizon mesh
function createHorizon() {
  const geo = new THREE.PlaneGeometry(5200, 520, 64, 1)
  const pos = geo.attributes.position as THREE.BufferAttribute
  // create jagged outrun peaks
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i) // becomes height after rotation
    // simple noise for silhouette
    const h = Math.pow(Math.abs(Math.sin(x * 0.0021) * 0.7 + Math.sin(x * 0.0053) * 0.3 + Math.cos(x * 0.0011) * 0.5), 2) * 140
    pos.setY(i, y + h)
  }
  geo.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0a0a1e,
    emissive: 0x12071a,
    emissiveIntensity: 0.6,
    roughness: 1,
    flatShading: true,
    wireframe: false,
    side: THREE.DoubleSide
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2 // already? Actually plane default XY; we want vertical billboard far ahead? simpler as ground horizon?
  // We'll place horizon as ring: rotate to stand vertical facing camera
  // Instead make it horizontal far ground: keep rotation -PI/2 and position far ahead, below
  mesh.position.set(0, -18, 700)
  // Actually better to create two horizon walls left/right? Keep simple: not adding to avoid clutter
  // Don't add for now – terrain already gives mountains
  // scene.add(mesh)
}
createHorizon()

// ——— World ———
const chunkMgr = new CyberChunkManager(scene)

// ——— Vehicle ———
const vehicleGroup = new THREE.Group()
vehicleGroup.position.set(0, 1, 6)
// initial orientation facing +Z
scene.add(vehicleGroup)

// placeholder while loading GLB: low-poly placeholder + lights
let vehicleMesh: THREE.Group | null = null
function createPlaceholder() {
  const g = new THREE.Group()
  // chassis box
  const bodyGeo = new THREE.BoxGeometry(1.92, 0.62, 4.2, 2, 1, 3)
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0f1018, roughness: 0.3, metalness: 0.6, emissive: 0x050516, emissiveIntensity: 0.5 })
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  body.position.y = 0.52
  g.add(body)
  // cabin
  const cabGeo = new THREE.BoxGeometry(1.62, 0.48, 1.9)
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x101828, roughness: 0.2, metalness: 0.7 })
  const cab = new THREE.Mesh(cabGeo, cabMat)
  cab.position.set(0, 0.98, -0.22)
  g.add(cab)
  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.44, 16)
  wheelGeo.rotateZ(Math.PI / 2)
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 })
  const offsets = [[0.92, 0.18, 1.15], [-0.92, 0.18, 1.15], [0.92, 0.18, -1.12], [-0.92, 0.18, -1.12]]
  for (const o of offsets) { const w = new THREE.Mesh(wheelGeo, wheelMat); w.position.set(o[0], o[1], o[2]); g.add(w) }
  // headlights cyan emissive
  const hlGeo = new THREE.SphereGeometry(0.14, 10, 10)
  const hlMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 4.2 })
  const hlL = new THREE.Mesh(hlGeo, hlMat); hlL.position.set(0.62, 0.5, 2.02); g.add(hlL)
  const hlR = hlL.clone(); hlR.position.x = -0.62; g.add(hlR)
  // taillights red
  const tlMat = new THREE.MeshStandardMaterial({ color: 0xff0033, emissive: 0xff0033, emissiveIntensity: 3.0 })
  const tlL = new THREE.Mesh(hlGeo, tlMat); tlL.position.set(0.64, 0.5, -2.02); tlL.scale.setScalar(0.9); g.add(tlL)
  const tlR = tlL.clone(); tlR.position.x = -0.64; g.add(tlR)
  // point lights for glow
  const hlLight = new THREE.PointLight(0x00ffff, 12, 14); hlLight.position.set(0, 0.5, 2.6); g.add(hlLight)
  const tlLight = new THREE.PointLight(0xff0033, 6, 10); tlLight.position.set(0, 0.5, -2.6); g.add(tlLight)
  // slight underglow
  const under = new THREE.PointLight(0xff0055, 8, 8); under.position.set(0, -0.25, 0); g.add(under)
  vehicleMesh = g
  vehicleGroup.add(g)
}
createPlaceholder()

// GLB loader with DRACO
const loader = new GLTFLoader()
const draco = new DRACOLoader()
draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')
loader.setDRACOLoader(draco)

async function loadVehicle() {
  try {
    const gltf = await loader.loadAsync('/assets/models/citroen_ds_survolt.glb')
    const root = gltf.scene
    // correct colorspace
    root.traverse((o: any) => {
      if (o.isMesh) {
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          for (const m of mats) {
            if (m.map) m.map.colorSpace = THREE.SRGBColorSpace
            if (m.emissiveMap) m.emissiveMap.colorSpace = THREE.SRGBColorSpace
            // boost
            if (m.emissive) m.emissiveIntensity = (m.emissiveIntensity || 1) * 1.0
            m.needsUpdate = true
          }
        }
        o.castShadow = false
        o.receiveShadow = false
      }
    })
    // normalize scale & position to fit racing view
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    // DS Survolt is ~4.1m long ≈ 4.1 units; normalize to ~3.9 length in our world scale
    const targetLen = 4.0
    const longest = Math.max(size.x, size.z)
    const s = longest > 0 ? targetLen / longest : 1
    root.scale.setScalar(s)
    root.updateMatrixWorld(true)
    const box2 = new THREE.Box3().setFromObject(root)
    const center = box2.getCenter(new THREE.Vector3())
    root.position.sub(center)
    root.position.y += 0.62 // lift to ground
    root.position.z += 0.08
    // Survolt GLB faces -Z or +Z? Test: assume +Z forward, adjust
    // We will try to orient: rotate 180 if needed
    // Check by seeing if bounding center is offset, but keep generic: rotate to face +Z (road direction)
    // The model originally faces +Z? We'll set rotation Y = 0 and fine-tune
    root.rotation.set(0, Math.PI, 0)

    // remove placeholder
    if (vehicleMesh) {
      vehicleGroup.remove(vehicleMesh)
      vehicleMesh = null
    }
    vehicleMesh = root
    vehicleGroup.add(root)

    // add emissive lights for headlights/brakes (approximate positions after scale)
    const hl = new THREE.PointLight(0x00ffff, 18, 16); hl.position.set(0, 0.55, 2.05); vehicleMesh.add(hl)
    const tl = new THREE.PointLight(0xff0033, 10, 12); tl.position.set(0, 0.55, -1.95); vehicleMesh.add(tl)
    // gentle underglow
    const under = new THREE.PointLight(0xff0055, 6, 6); under.position.set(0, -0.2, 0); vehicleMesh.add(under)

    // store lights for braking intensity
    ;(vehicleGroup as any)._hl = hl
    ;(vehicleGroup as any)._tl = tl

    showNotice('Citroën DS Survolt cargado ✓', 2000)
  } catch (e) {
    console.error('GLB load failed', e)
    showNotice('Usando vehículo placeholder (GLB no cargado)', 2600)
  }
}
loadVehicle()

// ——— Input ———
const keys = new Set<string>()
addEventListener('keydown', (e) => {
  keys.add(e.code)
  if (e.code === 'Space') e.preventDefault()
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !running) start()
})
addEventListener('keyup', (e) => keys.delete(e.code))

function getInput(): { accel: number, steer: number, brake: boolean } {
  let accel = 0
  if (keys.has('KeyW') || keys.has('ArrowUp')) accel += 1
  if (keys.has('KeyS') || keys.has('ArrowDown')) accel -= 1
  // touch / space brake
  let steer = 0
  if (keys.has('KeyA') || keys.has('ArrowLeft')) steer -= 1
  if (keys.has('KeyD') || keys.has('ArrowRight')) steer += 1
  const brake = keys.has('Space')
  // gamepad? ignore
  // normalize diagonal? not needed
  return { accel, steer, brake }
}

// touch controls for mobile: left/right half + top/bottom
let touchSteer = 0
let touchAccel = 0
canvas.addEventListener('touchstart', (e) => {
  const t = e.touches[0]
  if (!t) return
  const x = t.clientX / innerWidth
  const y = t.clientY / innerHeight
  touchSteer = x < 0.5 ? -1 : 1
  touchAccel = y < 0.5 ? 1 : (y > 0.85 ? -0.7 : 1)
  if (x < 0.33) touchSteer = -1
  else if (x > 0.66) touchSteer = 1
  else touchSteer = 0
  e.preventDefault()
}, { passive: false })
canvas.addEventListener('touchmove', (e) => {
  const t = e.touches[0]
  if (!t) return
  const x = t.clientX / innerWidth
  if (x < 0.33) touchSteer = -1
  else if (x > 0.66) touchSteer = 1
  else touchSteer = 0
  e.preventDefault()
}, { passive: false })
canvas.addEventListener('touchend', () => { touchSteer = 0; touchAccel = 0 })

// ——— Controllers ———
const vehicleCtrl = new VehicleController(vehicleGroup)
const camRig = new CameraRig(camera, vehicleGroup)

// start state
let running = false
let paused = false

function start() {
  if (running) return
  running = true
  paused = false
  overlay.classList.add('hidden')
  showNotice('Motores encendidos — ¡Acelera!  W / ↑', 1800)
}

// overlay clicks
enterBtn.addEventListener('click', (e) => { e.stopPropagation(); start() })
overlay.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).id === 'overlay') start()
})
canvas.addEventListener('click', () => {
  if (!running) start()
})

addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && running) {
    paused = !paused
    if (paused) { overlay.classList.remove('hidden'); showNotice('PAUSA — ESC para continuar') }
    else overlay.classList.add('hidden')
  }
})

// ——— Minimap ———
function drawMinimap(progress: number, lateral: number) {
  const w = minimap.width, h = minimap.height
  mctx.clearRect(0, 0, w, h)
  // background grid
  mctx.fillStyle = '#060610'
  mctx.fillRect(0, 0, w, h)
  mctx.strokeStyle = 'rgba(0,255,255,0.08)'
  mctx.lineWidth = 1
  for (let i = 0; i < w; i += 18) { mctx.beginPath(); mctx.moveTo(i, 0); mctx.lineTo(i, h); mctx.stroke() }
  for (let i = 0; i < h; i += 18) { mctx.beginPath(); mctx.moveTo(0, i); mctx.lineTo(w, i); mctx.stroke() }

  // road trace
  const range = 600 // 600 units ahead/behind
  const behind = 120
  const ahead = range
  const steps = 96
  const cx = w * 0.5
  const cy = h * 0.78
  const scale = 0.16 // world to minimap
  mctx.lineWidth = 6
  mctx.strokeStyle = '#0a0a14'
  mctx.lineCap = 'round'
  mctx.lineJoin = 'round'
  mctx.beginPath()
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const z = THREE.MathUtils.lerp(progress - behind, progress + ahead, t)
    const rx = roadCenter(z).x
    const x = cx + rx * scale * 4.2 // exaggerate lateral for readability
    const y = cy - (z - progress) * scale
    if (i === 0) mctx.moveTo(x, y)
    else mctx.lineTo(x, y)
  }
  mctx.stroke()

  // neon edge for minimap (cyan/magenta)
  mctx.lineWidth = 1.7
  mctx.strokeStyle = '#00ffff'
  mctx.shadowColor = '#00ffff'; mctx.shadowBlur = 6
  mctx.beginPath()
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const z = THREE.MathUtils.lerp(progress - behind, progress + ahead, t)
    const rx = roadCenter(z).x
    const x = cx + rx * scale * 4.2
    const y = cy - (z - progress) * scale
    if (i === 0) mctx.moveTo(x, y); else mctx.lineTo(x, y)
  }
  mctx.stroke()
  mctx.shadowBlur = 0

  // vehicle dot with lateral
  const rx0 = roadCenter(progress).x
  const vx = cx + (rx0 + lateral) * scale * 4.2
  const vy = cy
  // outer glow
  mctx.fillStyle = 'rgba(255,0,85,0.9)'
  mctx.shadowColor = '#ff0055'; mctx.shadowBlur = 10
  mctx.beginPath(); mctx.arc(vx, vy, 4.2, 0, Math.PI * 2); mctx.fill()
  mctx.shadowBlur = 0
  mctx.fillStyle = '#ffffff'
  mctx.beginPath(); mctx.arc(vx, vy, 1.7, 0, Math.PI * 2); mctx.fill()

  // progress indicator text
  mctx.fillStyle = 'rgba(0,255,255,0.9)'
  mctx.font = '700 8px "Share Tech Mono"'
  mctx.textAlign = 'left'
  mctx.fillText(`${Math.floor(progress)} m`, 6, h - 6)
  mctx.textAlign = 'right'
  mctx.fillStyle = 'rgba(255,255,255,0.55)'
  mctx.fillText(`${Math.floor(vehicleCtrl.getSpeedKmh())} KM/H`, w - 6, h - 6)
}

// ——— Loop ———
let last = performance.now()
let fpsAcc = 0, fpsCount = 0, lastFpsTime = performance.now(), fps = 60
let frame = 0

function loop() {
  const now = performance.now()
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now
  frame++

  if (!paused) {
    // input
    const k = getInput()
    // merge touch
    let accel = k.accel, steer = k.steer
    if (touchAccel !== 0) accel = touchAccel
    if (touchSteer !== 0) steer = touchSteer
    // auto-accelerate gentle if running but no input? keep slight roll? No, require input but allow idle
    vehicleCtrl.update(dt, { accel, steer, brake: k.brake })

    // chunk streaming
    chunkMgr.update(vehicleCtrl.progress)

    // camera spring (use vehicleCtrl speed/steer)
    camRig.update(dt, vehicleCtrl.speed, vehicleCtrl.steerValue, vehicleCtrl.progress)

    // stars subtle rotation with progress (parallax) – keep stars static but move with camera? Instead keep stars centered on camera
    stars.position.copy(camera.position)
    stars.position.y -= 80 // keep above

    // brake lights intensity
    const tl = (vehicleGroup as any)._tl as THREE.PointLight | undefined
    const hl = (vehicleGroup as any)._hl as THREE.PointLight | undefined
    if (tl) tl.intensity = (vehicleCtrl.speed < -1 || k.brake || k.accel < 0) ? 14 : 5
    if (hl) hl.intensity = 10 + Math.abs(vehicleCtrl.speed) * 0.08

    // HUD
    const kmh = vehicleCtrl.getSpeedKmh()
    speedValEl.textContent = String(Math.floor(kmh)).padStart(3, '0')
    // minimap throttled 30Hz
    if (frame % 2 === 0) drawMinimap(vehicleCtrl.progress, vehicleCtrl.lateral)
  }

  // fps
  fpsAcc += dt; fpsCount++
  if (now - lastFpsTime > 500) {
    fps = Math.round(fpsCount / fpsAcc)
    fpsCount = 0; fpsAcc = 0; lastFpsTime = now
    const stats = chunkMgr.getStats()
    fpsEl.textContent = `${fps} FPS • CHUNK ${Math.floor(vehicleCtrl.progress / 300)} • ${stats.loaded} ACTIVOS • ${vehicleCtrl.getSpeedKmh().toFixed(0)} KM/H`
  }

  renderer.render(scene, camera)
  requestAnimationFrame(loop)
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()
chunkMgr.update(vehicleCtrl.progress)
drawMinimap(vehicleCtrl.progress, vehicleCtrl.lateral)
camRig.snap(vehicleGroup.position, vehicleCtrl.progress)
loop()

// preload chunks ahead
for (let i = 0; i < 2; i++) chunkMgr.update(vehicleCtrl.progress + i * 300)

// show tip
setTimeout(()=> { if (!running) showNotice('Pulsa INICIAR MOTORES o ENTER', 2600) }, 600)

// attribution console
console.log('%c CYBERDRIVE 3D %c Synthwave Racing • Three.js • Procedural Chunks ', 'background:#00ffff;color:#020208;font-weight:800;padding:4px 8px;border-radius:6px 0 0 6px', 'background:#ff0055;color:white;font-weight:700;padding:4px 8px;border-radius:0 6px 6px 0')
console.log('Vehículo: "2010 Citroën DS Survolt" by Ddiaz Design — CC BY-NC-SA 4.0 — https://skfb.ly/pNPRJ')
