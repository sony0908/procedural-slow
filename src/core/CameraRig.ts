import * as THREE from 'three'
import { roadCenter, roadTangent } from '../world/Road'

export class CameraRig {
  private pos = new THREE.Vector3()
  private vel = new THREE.Vector3()
  private targetPos = new THREE.Vector3()
  private lookAt = new THREE.Vector3()
  private roll = 0

  // FIX retroceso al acelerar → spring casi rígido + FOV mínimo (slowroads: cámara pegada al coche)
  stiffness = 78
  damping = 22
  distance = 6.0
  height = 2.35
  lookAhead = 9.5
  fovBase = 66
  fovMaxBoost = 2.2 // antes 7 → aún parecía pull-back; slowroads usa ~2

  // órbita libre con ratón (slowroads: arrastrar para ver el auto 360°)
  orbitYaw = 0
  orbitPitch = 0
  private isDragging = false
  private lastX = 0
  private lastY = 0
  private idleReturn = 0 // 0 = no retorno automático, >0 = lerp a 0

  constructor(private camera: THREE.PerspectiveCamera, private vehicle: THREE.Group) {
    this.pos.copy(vehicle.position).add(new THREE.Vector3(0, this.height, -this.distance))
  }

  attachDOM(dom: HTMLElement) {
    dom.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      this.isDragging = true; this.lastX = e.clientX; this.lastY = e.clientY
      dom.style.cursor = 'grabbing'
      e.preventDefault()
    })
    window.addEventListener('mouseup', () => {
      if (this.isDragging) { this.isDragging = false; dom.style.cursor = 'grab' }
    })
    dom.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return
      const dx = e.clientX - this.lastX
      const dy = e.clientY - this.lastY
      this.lastX = e.clientX; this.lastY = e.clientY
      this.orbitYaw -= dx * 0.0052   // arrastrar derecha → cámara a derecha (yaw negativo)
      this.orbitPitch -= dy * 0.0040
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch, -0.62, 0.78) // no voltear bajo suelo
      this.idleReturn = 0
    })
    // touch
    dom.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return
      this.isDragging = true; this.lastX = e.touches[0].clientX; this.lastY = e.touches[0].clientY
    }, { passive: true })
    window.addEventListener('touchend', () => { this.isDragging = false })
    dom.addEventListener('touchmove', (e) => {
      if (!this.isDragging || e.touches.length !== 1) return
      const dx = e.touches[0].clientX - this.lastX
      const dy = e.touches[0].clientY - this.lastY
      this.lastX = e.touches[0].clientX; this.lastY = e.touches[0].clientY
      this.orbitYaw -= dx * 0.006
      this.orbitPitch -= dy * 0.0048
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch, -0.62, 0.78)
      this.idleReturn = 0
    }, { passive: true })
    dom.addEventListener('wheel', (e) => {
      this.distance = THREE.MathUtils.clamp(this.distance + Math.sign(e.deltaY) * 0.42, 3.2, 11)
      e.preventDefault()
    }, { passive: false })
    // doble click o R resetea órbita
    dom.addEventListener('dblclick', () => this.resetOrbit())
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR' && !e.ctrlKey) this.resetOrbit()
    })
    dom.style.cursor = 'grab'
  }

  resetOrbit() {
    // animar retorno suave a 0 en ~0.6s
    this.idleReturn = 1
    // no snap inmediato, lerp en update
  }

  update(dt: number, speed: number, steerValue: number, progress: number) {
    const t = roadTangent(progress)
    // SLOWROADS: cámara sigue el centro de la pista, NO el lateral del coche (independiente al girar)
    const roadPos = roadCenter(progress)
    const vehPos = this.vehicle.position.clone()
    // offset base detrás + arriba
    const behindBase = t.clone().multiplyScalar(-this.distance)
    const up = new THREE.Vector3(0, this.height, 0)
    let offset = behindBase.clone().add(up)

    // órbita libre: rotar offset alrededor del coche
    if (Math.abs(this.orbitYaw) > 1e-4 || Math.abs(this.orbitPitch) > 1e-4) {
      // yaw alrededor de Y
      if (Math.abs(this.orbitYaw) > 1e-4) {
        const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.orbitYaw)
        offset.applyQuaternion(qYaw)
      }
      // pitch alrededor de right del camino
      if (Math.abs(this.orbitPitch) > 1e-4) {
        const right = new THREE.Vector3().crossVectors(t, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(-1)
        const qPitch = new THREE.Quaternion().setFromAxisAngle(right, this.orbitPitch)
        offset.applyQuaternion(qPitch)
      }
    }
    // si no hay órbita, la cámara está en roadPos+offset; si hay órbita, orbita alrededor de vehPos para ver el auto 360°
    const pivot = (Math.abs(this.orbitYaw) > 0.01 || Math.abs(this.orbitPitch) > 0.01) ? vehPos : roadPos
    this.targetPos.copy(pivot).add(offset)
    // retorno suave a centro si se pidió reset
    if (this.idleReturn > 0) {
      this.orbitYaw = THREE.MathUtils.lerp(this.orbitYaw, 0, 1 - Math.exp(-4.5 * dt))
      this.orbitPitch = THREE.MathUtils.lerp(this.orbitPitch, 0, 1 - Math.exp(-4.5 * dt))
      if (Math.abs(this.orbitYaw) < 0.002 && Math.abs(this.orbitPitch) < 0.002) {
        this.orbitYaw = 0; this.orbitPitch = 0; this.idleReturn = 0
      }
    }

    // SLOWROADS: cámara pegada, retroceso natural ≤1m por spring rígido (sin clamp duro que temblaba)
    const accel = this.targetPos.clone().sub(this.pos).multiplyScalar(this.stiffness)
    accel.add(this.vel.clone().multiplyScalar(-this.damping))
    this.vel.addScaledVector(accel, dt)
    this.pos.addScaledVector(this.vel, dt)
    // clamp suave solo si supera 1.0m (no 0.45) para no jitter
    const distErr = this.targetPos.distanceTo(this.pos)
    if (distErr > 1.0) {
      this.pos.lerp(this.targetPos, 0.55)
      this.vel.multiplyScalar(0.5)
    }

    this.camera.position.copy(this.pos)

    // lookAt: si hay órbita, mirar al coche; si no, mirar curva adelante (slowroads)
    const isOrbiting = Math.abs(this.orbitYaw) > 0.02 || Math.abs(this.orbitPitch) > 0.02 || this.isDragging
    let aheadPos: THREE.Vector3
    if (isOrbiting) {
      aheadPos = vehPos.clone(); aheadPos.y += 0.42
    } else {
      aheadPos = roadCenter(progress + this.lookAhead).clone(); aheadPos.y += 0.45
    }
    // smooth lookAt
    this.lookAt.lerp(aheadPos, 1 - Math.exp(-7 * dt))
    this.camera.lookAt(this.lookAt)

    // FIX slowroads plano total: sin roll de cámara ni coche (usuario: inclina rompe física)
    const targetRoll = 0
    this.roll = THREE.MathUtils.lerp(this.roll, targetRoll, 1 - Math.exp(-2.8 * dt))
    // forward tras lookAt
    const forward = new THREE.Vector3().subVectors(this.lookAt, this.camera.position).normalize()
    const qBase = this.camera.quaternion.clone()
    const qRoll = new THREE.Quaternion().setFromAxisAngle(forward, this.roll)
    // qFinal = qRoll * qBase  (roll alrededor de forward)
    this.camera.quaternion.copy(qBase).premultiply(qRoll)
    // mantener up razonable para evitar flip
    this.camera.up.set(0, 1, 0)

    // FOV boost with speed
    const speed01 = THREE.MathUtils.clamp(Math.abs(speed) / 72, 0, 1)
    const targetFov = this.fovBase + speed01 * this.fovMaxBoost
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-2.2 * dt))
    this.camera.updateProjectionMatrix()
  }

  snap(vehiclePos: THREE.Vector3, progress: number) {
    const t = roadTangent(progress)
    const rc = roadCenter(progress)
    this.pos.copy(rc).add(t.clone().multiplyScalar(-this.distance)).add(new THREE.Vector3(0,this.height,0))
    this.vel.set(0,0,0)
    this.camera.position.copy(this.pos)
  }
}
