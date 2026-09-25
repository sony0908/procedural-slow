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

  maxSpeed = 88
  accelPower = 18
  brakePower = 34
  friction = 1.15
  steerSpeed = 2.85 // más reactivo (antes 1.65 muy flotante → parecía no girar)
  lateralSpeed = 14
  yawLerp = 3.4 // antes 1.45 → guiñada responde en ~0.3s no 2s
  pitchLerp = 1.35
  rollLerp = 12

  private lateralLimit = ROAD_WIDTH * 0.5 - 1.15 // leave margin for car width
  // ruedas delanteras para steer visual
  frontWheels: THREE.Object3D[] = []
  rearWheels: THREE.Object3D[] = []
  private wheelSpin = 0
  // suspensión slowroads: rebote al doblar
  private suspension = 0
  private suspensionVel = 0
  private prevSteer = 0
  private prevLateral = 0

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

    const speedFactor = THREE.MathUtils.clamp(Math.abs(this.speed) / 18, 0, 1)
    const steerEffect = this.steerValue * speedFactor
    // lateral: derecha = +X (normal derecha), A/← izq, D/→ der
    const lateralVel = steerEffect * (9 + Math.abs(this.speed) * 0.11) * 1.0
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
    // FIX saltos: lerp hacia targetY+hover + suspensión rebote al girar (slowroads)
    const HOVER = 0.42
    const targetYHover = pos.y + HOVER
    const curY = this.vehicle.position.y
    const vyAlpha = 1 - Math.exp(-6 * dt)
    let newY = THREE.MathUtils.lerp(curY, targetYHover, vyAlpha)
    // suspensión rebote al girar — desactivado temporalmente para evitar temblor (usuario reportó shake)
    // const steerDelta = Math.abs(this.steerValue - this.prevSteer)
    // const lateralDelta = Math.abs(this.lateral - this.prevLateral)
    // this.prevSteer = this.steerValue; this.prevLateral = this.lateral
    // const turnForce = (steerDelta * 0.12 + lateralDelta * 0.04) * Math.min(1, Math.abs(this.speed) * 0.03 + 0.15)
    // this.suspensionVel -= turnForce * 0.28
    // const k = 18, d = 8.5
    // this.suspensionVel += (-this.suspension * k - this.suspensionVel * d) * dt
    // this.suspension += this.suspensionVel * dt
    // this.suspension = THREE.MathUtils.clamp(this.suspension, -0.018, 0.018)
    // newY += this.suspension
    pos.y = newY

    this.vehicle.position.copy(pos)

    // giro real: volante añade yaw (slowroads ~22°) mismo signo que lateral
    const roadYaw = Math.atan2(tangent.x, tangent.z)
    const steerYaw = this.steerValue * 0.38 * speedFactor
    const targetYaw = roadYaw + steerYaw
    const targetPitch = -Math.asin(THREE.MathUtils.clamp(tangent.y, -1, 1)) * 0.55
    const targetRoll = 0

    this.yaw = THREE.MathUtils.lerp(this.yaw, targetYaw, 1 - Math.exp(-this.yawLerp * dt))
    this.pitch = THREE.MathUtils.lerp(this.pitch, targetPitch, 1 - Math.exp(-this.pitchLerp * dt))
    this.roll = THREE.MathUtils.lerp(this.roll, targetRoll, 1 - Math.exp(-10 * dt))

    this.vehicle.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ')

    // ruedas delanteras giran al doblar + spin por velocidad
    const maxSteerAngle = 0.52
    const steerAngle = this.steerValue * maxSteerAngle
    this.wheelSpin += this.speed * dt * 5.4
    // front: steer en Y del pivot, spin en X de todos los hijos meshes
    for (const w of this.frontWheels) {
      const isPivot = w.children.length > 0 && (w.children[0] as any).isMesh
      if (isPivot) {
        w.rotation.y = steerAngle
        w.children.forEach((c:any)=>{ if(c.isMesh) c.rotation.x = this.wheelSpin })
      } else {
        w.rotation.y = steerAngle
        ;(w as any).rotation.x = this.wheelSpin
      }
    }
    for (const w of this.rearWheels) {
      const isPivot = w.children.length > 0 && (w.children[0] as any).isMesh
      if (isPivot) {
        w.children.forEach((c:any)=>{ if(c.isMesh) c.rotation.x = this.wheelSpin })
      } else {
        ;(w as any).rotation.x = this.wheelSpin
      }
    }
  }

  // helpers
  getSpeedKmh(): number {
    // 1 unit ~ 1 m, speed in m/s -> km/h = *3.6
    return Math.abs(this.speed) * 3.6
  }
  getProgress(): number { return this.progress }
}
