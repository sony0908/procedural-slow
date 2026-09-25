import * as THREE from 'three'
import { roadCenter, roadTangent, ROAD_WIDTH } from '../world/Road'

export type InputState = {
  accel: number // -1..1 (W/S)
  steer: number // -1..1 (A/D)
  brake: boolean
}

export class VehicleController {
  // physical state
  progress = 6 // z along road (meters units)
  speed = 0 // units per second (1 unit ~ 1m)
  lateral = 0 // offset from center (-ROAD_WIDTH/2 .. +)
  steerValue = 0 // smoothed steering -1..1
  yaw = 0
  pitch = 0
  roll = 0

  // config – tuned for smooth cinematic feel (slowroads style)
  maxSpeed = 92 // ~331 km/h max
  accelPower = 26
  brakePower = 42
  friction = 1.6 // natural drag
  steerSpeed = 3.2 // lerp speed for steerValue
  lateralSpeed = 14 // how fast lateral responds
  // smoothing for orientation
  yawLerp = 4.5
  pitchLerp = 3.0
  rollLerp = 2.8

  private lateralLimit = ROAD_WIDTH * 0.5 - 1.15 // leave margin for car width

  constructor(private vehicle: THREE.Group) {}

  update(dt: number, input: InputState) {
    // steer smoothing (Lerp / Spring)
    const targetSteer = THREE.MathUtils.clamp(input.steer, -1, 1)
    this.steerValue = THREE.MathUtils.lerp(this.steerValue, targetSteer, 1 - Math.exp(-this.steerSpeed * dt))

    // acceleration / braking with inertia
    let accel = 0
    if (input.accel > 0) accel = input.accel * this.accelPower
    else if (input.accel < 0) accel = input.accel * this.brakePower * 0.6 // reverse slower

    if (input.brake) accel -= this.brakePower * 0.9

    // friction / drag (environmental)
    const drag = this.friction * (0.35 + Math.abs(this.speed) * 0.012)
    if (Math.abs(this.speed) > 0.1) {
      accel -= Math.sign(this.speed) * drag
    }
    // low speed clamp to stop jitter
    this.speed += accel * dt
    // progressive damping at low speed
    if (Math.abs(this.speed) < 0.6 && Math.abs(accel) < 1e-3) this.speed *= 0.88
    // clamp
    this.speed = THREE.MathUtils.clamp(this.speed, -this.maxSpeed * 0.28, this.maxSpeed)
    // prevent going backwards too fast
    if (this.speed < 0 && input.accel <= 0 && !input.brake) {
      this.speed = THREE.MathUtils.lerp(this.speed, 0, dt * 2.5)
    }

    // FIX controles invertidos: invertir lateral (antes derecha→izq)
    const speedFactor = THREE.MathUtils.clamp(Math.abs(this.speed) / 18, 0, 1) // 0 when stopped, 1 at 18 u/s
    const steerEffect = this.steerValue * speedFactor
    // lateral invertido para que A/← = izq y D/→ = der
    const lateralVel = -steerEffect * (9 + Math.abs(this.speed) * 0.11) * 1.0 // invertido
    this.lateral += lateralVel * dt
    // auto-centering spring when no steer (gentle)
    if (Math.abs(targetSteer) < 0.08) {
      this.lateral = THREE.MathUtils.lerp(this.lateral, 0, dt * 0.45 * speedFactor)
    }
    this.lateral = THREE.MathUtils.clamp(this.lateral, -this.lateralLimit, this.lateralLimit)

    // progress along track (distance)
    // ensure minimum speed to feel cinematic? but allow stop
    this.progress += this.speed * dt
    if (this.progress < 2) this.progress = 2

    // alignment on spline: get road center + offset
    const center = roadCenter(this.progress)
    const tangent = roadTangent(this.progress)
    const up = new THREE.Vector3(0, 1, 0)
    const normal = new THREE.Vector3().crossVectors(tangent, up).normalize().multiplyScalar(-1)
    const pos = center.clone().addScaledVector(normal, this.lateral)
    // FIX saltos: lerp hacia targetY+hover (no hacia targetY solo)
    const HOVER = 0.42 // altura sobre asfalto (antes 0.72 causaba divergencia)
    const targetYHover = pos.y + HOVER
    const curY = this.vehicle.position.y
    // spring suave sin overshoot (8 -> 6 para menos nervioso)
    const vyAlpha = 1 - Math.exp(-6 * dt)
    const newY = THREE.MathUtils.lerp(curY, targetYHover, vyAlpha)
    pos.y = newY

    this.vehicle.position.copy(pos)

    // orientación: alineación con tangente, pitch/roll suavizados (roll invertido para acompañar giro)
    const targetYaw = Math.atan2(tangent.x, tangent.z) // yaw Y
    const targetPitch = -Math.asin(THREE.MathUtils.clamp(tangent.y, -1, 1))
    const targetRoll = this.steerValue * speedFactor * 0.32 + (this.lateral * 0.025)

    this.yaw = THREE.MathUtils.lerp(this.yaw, targetYaw, 1 - Math.exp(-this.yawLerp * dt))
    this.pitch = THREE.MathUtils.lerp(this.pitch, targetPitch, 1 - Math.exp(-this.pitchLerp * dt))
    this.roll = THREE.MathUtils.lerp(this.roll, targetRoll, 1 - Math.exp(-this.rollLerp * dt))

    this.vehicle.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ')

    // bob de suspensión desactivado para 60 FPS estable (antes 0.02 causaba saltos perceptibles)
    // si se quiere, usar amortiguado muy leve:
    // const bob = Math.sin(this.progress * 0.12) * 0.007 * (Math.abs(this.speed)/this.maxSpeed)
    // this.vehicle.position.y += bob
  }

  // helpers
  getSpeedKmh(): number {
    // 1 unit ~ 1 m, speed in m/s -> km/h = *3.6
    return Math.abs(this.speed) * 3.6
  }
  getProgress(): number { return this.progress }
}
