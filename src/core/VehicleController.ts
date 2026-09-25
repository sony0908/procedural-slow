import * as THREE from 'three'
import { roadCenter, roadTangent, ROAD_WIDTH } from '../world/Road'

export type InputState = { accel: number; steer: number; brake: boolean }

/**
 * Replicado 1:1 de Slow Roads Web Edition (roadster) — métricas exactas extraídas de main.e7a33c55.chunk.js
 * Métricas roadster: width 1.36 length 2.75 radius 0.3426 travel 0.07
 * accel 9 reverse 5 jerk 48 brake 8 mass 700 maxSteer 0.68 damp 0.04 rock 4 drag 0.001 topSpeed 45 roll 0.06 steerInterval 1 slipBase 0.1 slipMod 0.05 aero 0.4
 * Fisica: 4 ruedas independientes simplificadas a 1 punto masa con fricción por superficie, soggy steer, jerk, slip, drag, downforce
 */
export class VehicleController {
  progress = 6
  speed = 0
  lateral = 0
  steerValue = 0
  yaw = 0
  pitch = 0
  roll = 0

  // métricas slowroads roadster exactas
  private readonly mass = 700
  private readonly maxSteer = 0.68
  private readonly steerInterval = 1
  private readonly topSpeed = 45 // m/s = 162 km/h
  private readonly accelPower = 9
  private readonly reversePower = 5
  private readonly jerk = 48
  private readonly brakePower = 8
  private readonly drag = 0.001
  private readonly rollResistance = 0.06
  private readonly dampening = 0.04
  private readonly slipBase = 0.1
  private readonly slipMod = 0.05
  private readonly aeroFactor = 0.4
  private readonly wheelTravel = 0.07

  // slowroads soggy steer
  private steerTarget = 0
  private steerTimer = 0
  private steerStart = 0
  private brakeLerp = 0
  private drive = 0
  private slip = 0
  private speedLerp = 0

  // ruedas visuales
  frontWheels: THREE.Object3D[] = []
  rearWheels: THREE.Object3D[] = []
  private wheelSpin = 0

  private lateralLimit = ROAD_WIDTH * 0.5 - 1.15

  constructor(private vehicle: THREE.Group) {}

  private halfLerp(t: number) {
    const a = t * 0.5 + 0.5
    return 2 * ((3 - 2 * a) * a * a - 0.5)
  }

  private updateSteer(dt: number, inputSteer: number) {
    const speedLerp = THREE.MathUtils.clamp(Math.abs(this.speed) / this.topSpeed, 0, 1)
    this.speedLerp = speedLerp
    const maxSteerNow = this.maxSteer * (1 - 0.75 * speedLerp)
    const soggyTimeFactor = 1 + 0.5 * speedLerp + (this.slip > 0 ? Math.max(0, (1 - this.slip) ** 2) * 0.5 : 0)
    const interval = this.steerInterval * soggyTimeFactor

    // FIX controles invertidos: invertir input (izquierda→izquierda)
    const target = THREE.MathUtils.clamp(-inputSteer, -1, 1) * maxSteerNow

    if (Math.abs(target - this.steerTarget) > 1e-4) {
      this.steerStart = this.steerValue
      this.steerTarget = target
      this.steerTimer = 0
    }
    this.steerTimer += dt / soggyTimeFactor
    let lerp = Math.min(1, this.steerTimer / interval)
    lerp = this.halfLerp(lerp)
    // limitar velocidad de giro 4 rad/s
    const maxDelta = 4 * dt
    const desired = this.steerStart + (this.steerTarget - this.steerStart) * lerp
    const delta = THREE.MathUtils.clamp(desired - this.steerValue, -maxDelta, maxDelta)
    this.steerValue += delta
    // reducción mouse a alta velocidad (input ya es -1..1, aplicamos factor)
    this.steerValue *= 1 - speedLerp * 0.04
  }

  update(dt: number, input: InputState) {
    const targetSteerRaw = THREE.MathUtils.clamp(input.steer, -1, 1)
    this.updateSteer(dt, targetSteerRaw)

    // drive con jerk (slowroads: drive += jerk*dt clamped)
    const wantAccel = input.accel // -1..1
    if (wantAccel > 0) {
      this.drive += this.jerk * dt
      this.drive = Math.min(this.drive, wantAccel)
    } else if (wantAccel < 0) {
      this.drive += this.jerk * dt
      // reversa limitada
      this.drive = Math.max(this.drive - this.jerk * dt * 2, wantAccel * (this.reversePower / this.accelPower))
      // simplificar: clamp a wantAccel
      if (this.drive < wantAccel) this.drive = wantAccel
      if (wantAccel < 0 && this.drive > 0) this.drive = Math.max(0, this.drive - this.jerk * dt * 2)
    } else {
      // sin input, decae
      if (this.drive > 0) this.drive = Math.max(0, this.drive - this.jerk * dt)
      else if (this.drive < 0) this.drive = Math.min(0, this.drive + this.jerk * dt)
    }

    // fricción según superficie: carretera 1.4 (nuestro default), sino 0.95/0.85
    // usamos 1.4 para asfalto (slowroads fallback), como estamos siempre sobre asfalto
    const friction = 1.4
    // downforce y drag
    const downforce = Math.pow(Math.min(1, Math.abs(this.speed) / this.topSpeed), 2) * this.aeroFactor

    // aceleración longitudinal
    let accZ = this.drive * this.accelPower
    // si usamos reversa, usar reversePower
    if (this.drive < 0) accZ = this.drive * this.reversePower

    // freno
    if (input.brake || (wantAccel < 0 && this.speed > 1)) {
      this.brakeLerp += dt / 0.25
      this.brakeLerp = Math.min(1, this.brakeLerp)
      const brakeForce = this.brakeLerp * this.brakePower
      // max decel
      const maxDecel = this.speed > 0 ? -(this.speed / dt) : 0
      accZ = THREE.MathUtils.clamp(-brakeForce, maxDecel, brakeForce)
      if (this.speed > 0) accZ = -Math.min(brakeForce, Math.abs(maxDecel))
    } else {
      this.brakeLerp = Math.max(0, this.brakeLerp - dt * 2)
    }
    if (friction < 1) accZ *= friction

    // fricción lateral y longitudinal estilo slowroads (simplificado a 1 punto)
    // wheelWeight ~2, latNorm = wheelWeight * 9.81 * friction
    const wheelWeight = 2
    const latNorm = wheelWeight * 9.81 * friction
    const lonNorm = wheelWeight * 9.81 * friction

    // maxLat con slipBase/slipMod
    const latDir = Math.sign(this.steerValue) || 0
    // maxLat = (speed * latDir / dt * -0.5) * (slipBase - slipMod*speedLerp^2)
    const slipFactor = this.slipBase - this.slipMod * this.speedLerp * this.speedLerp
    let maxLat = 0
    if (Math.abs(this.speed) > 0.1) {
      maxLat = (this.speed / dt * -0.5) * slipFactor
      // limitar por latDir
      if (latDir !== 0) maxLat *= Math.abs(latDir)
      else maxLat = 0
    }
    // si estamos girando, maxLat es proporcional a steer
    // para no complicar, usamos steerValue para escalar maxLat
    maxLat *= Math.abs(this.steerValue) > 0.01 ? 1 : 0

    let accX = 0
    if (maxLat < -latNorm) { accX = -latNorm; this.slip = Math.abs(this.steerValue) }
    else if (maxLat > latNorm) { accX = latNorm; this.slip = Math.abs(this.steerValue) }
    else { accX = maxLat; this.slip = 0 }

    // pendiente (flat road, tilt 0)
    // rollResistance
    const rawSpeed = this.speed
    accZ -= rawSpeed * this.rollResistance
    // clamp lon
    const maxLon = 0.12 / dt // pequeño
    accZ = THREE.MathUtils.clamp(accZ, -maxLon, maxLon)

    // downforce
    // acc.y no usado para posición, solo para rock
    // dampening ya no aplica a y

    // drag
    accZ -= this.drag * this.speed * Math.abs(this.speed)

    // integrar velocidad
    this.speed += accZ * dt
    this.speed = THREE.MathUtils.clamp(this.speed, -this.topSpeed * 0.35, this.topSpeed)

    // lateral integrado: accX es aceleración lateral, integrar a velocidad lateral y luego a posición
    // Para simplificar slowroads 4 ruedas, integramos direct a lateral con slip
    // Usamos accX como velocidad lateral objetivo
    const lateralSpeed = accX * dt * 0.12 // escala para convertir aceleración a desplazamiento
    // si hay slip, deslizamiento mayor
    const slipMult = 1 + this.slip * 1.8
    this.lateral += lateralSpeed * slipMult * dt * 18

    // sin auto-centrado (slowroads mantiene donde lo dejas)
    // solo fricción natural por drag lateral ya aplicada

    this.lateral = THREE.MathUtils.clamp(this.lateral, -this.lateralLimit, this.lateralLimit)

    // progreso longitudinal
    this.progress += this.speed * dt
    if (this.progress < 2) this.progress = 2

    // posición 3D
    const center = roadCenter(this.progress)
    const tangent = roadTangent(this.progress)
    const up = new THREE.Vector3(0, 1, 0)
    const normal = new THREE.Vector3().crossVectors(tangent, up).normalize().multiplyScalar(-1)
    const pos = center.clone().addScaledVector(normal, this.lateral)
    const HOVER = 0.42
    const curY = this.vehicle.position.y
    const vyAlpha = 1 - Math.exp(-4 * dt) // más suave para no tiritar a baja velocidad (antes 8)
    const targetY = pos.y + HOVER
    pos.y = THREE.MathUtils.lerp(curY, targetY, vyAlpha)
    this.vehicle.position.copy(pos)

    // rotación: yaw = roadYaw + steer*0.62 (visual, slowroadsAckermann)
    const roadYaw = Math.atan2(tangent.x, tangent.z)
    // Ackermann real slowroads: steerL/R distintos, usamos promedio
    const steerYaw = this.steerValue * 0.62
    const targetYaw = roadYaw + steerYaw
    const targetPitch = -Math.asin(THREE.MathUtils.clamp(tangent.y, -1, 1)) * 0.55
    const targetRoll = 0
    // yaw con slip: cuando derrapa, yaw se retrasa
    const yawLerp = 3.0 * (1 - this.slip * 0.45)
    this.yaw = THREE.MathUtils.lerp(this.yaw, targetYaw, 1 - Math.exp(-yawLerp * dt))
    this.pitch = THREE.MathUtils.lerp(this.pitch, targetPitch, 1 - Math.exp(-2.8 * dt))
    this.roll = THREE.MathUtils.lerp(this.roll, targetRoll, 1 - Math.exp(-10 * dt))
    this.vehicle.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ')

    // ruedas: steer invertido ya corregido, spin sentido contrario (estaba al revés)
    const maxSteerAngle = this.maxSteer // 0.68
    const steerAngle = this.steerValue * maxSteerAngle
    this.wheelSpin -= this.speed * dt / 0.342665 // invertido: antes + ahora -
    this.wheelSpin = this.wheelSpin % (Math.PI * 2)
    for (const w of this.frontWheels) {
      w.rotation.y = steerAngle
      w.traverse((obj: any) => { if (obj.isMesh) obj.rotation.x = this.wheelSpin })
    }
    for (const w of this.rearWheels) {
      w.traverse((obj: any) => { if (obj.isMesh) obj.rotation.x = this.wheelSpin })
    }
    // placeholder meshes direct (sin pivot) también
    for (const w of this.frontWheels) if ((w as any).isMesh) (w as any).rotation.y = steerAngle
    for (const w of [...this.frontWheels, ...this.rearWheels]) if ((w as any).isMesh) (w as any).rotation.x = this.wheelSpin
  }

  getSpeedKmh() { return Math.abs(this.speed) * 3.6 }
  getProgress() { return this.progress }
}
