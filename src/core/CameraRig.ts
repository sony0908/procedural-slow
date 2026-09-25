import * as THREE from 'three'
import { roadTangent } from '../world/Road'

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

  constructor(private camera: THREE.PerspectiveCamera, private vehicle: THREE.Group) {
    this.pos.copy(vehicle.position).add(new THREE.Vector3(0, this.height, -this.distance))
  }

  update(dt: number, speed: number, steerValue: number, progress: number) {
    const t = roadTangent(progress)
    // chase position: behind vehicle along tangent
    const vehPos = this.vehicle.position.clone()
    // offset behind: -tangent * distance + up*height, with small lateral offset to see curve
    const behind = t.clone().multiplyScalar(-this.distance)
    const up = new THREE.Vector3(0, this.height, 0)
    // drift lateral mínimo (slowroads no desplaza cámara al girar)
    const right = new THREE.Vector3().crossVectors(t, new THREE.Vector3(0,1,0)).normalize().multiplyScalar(-1)
    const lateralShift = right.clone().multiplyScalar(steerValue * 0.12)

    this.targetPos.copy(vehPos).add(behind).add(up).add(lateralShift)

    // SLOWROADS: cámara pegada, retroceso MÁX 1.0m (usuario pidió ≤1m)
    // spring ultra-rígido + clamp duro
    const accel = this.targetPos.clone().sub(this.pos).multiplyScalar(this.stiffness)
    accel.add(this.vel.clone().multiplyScalar(-this.damping))
    this.vel.addScaledVector(accel, dt)
    this.pos.addScaledVector(this.vel, dt)
    // clamp duro: nunca más de 1.0m del target
    const distErr = this.targetPos.distanceTo(this.pos)
    if (distErr > 0.95) {
      // proyectar hacia target limitando a 0.95m (margen antes de 1.0)
      const dir = this.pos.clone().sub(this.targetPos).normalize()
      this.pos.copy(this.targetPos).addScaledVector(dir, 0.95)
      this.vel.multiplyScalar(0.55)
    } else if (distErr > 0.45) {
      // suavizado extra cuando supera 0.45 para que no llegue a 1.0
      this.pos.lerp(this.targetPos, 1 - Math.exp(-32 * dt))
      this.vel.multiplyScalar(0.68)
    }

    this.camera.position.copy(this.pos)

    // look ahead corto y estable (slowroads mira justo delante)
    const aheadPos = vehPos.clone().add(t.clone().multiplyScalar(this.lookAhead))
    aheadPos.y += 0.45
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
    this.pos.copy(vehiclePos).add(t.clone().multiplyScalar(-this.distance)).add(new THREE.Vector3(0,this.height,0))
    this.vel.set(0,0,0)
    this.camera.position.copy(this.pos)
  }
}
