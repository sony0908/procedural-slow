import * as THREE from 'three'
import { roadTangent } from '../world/Road'

export class CameraRig {
  private pos = new THREE.Vector3()
  private vel = new THREE.Vector3()
  private targetPos = new THREE.Vector3()
  private lookAt = new THREE.Vector3()
  private roll = 0

  // config
  stiffness = 22
  damping = 7.5
  distance = 11.5
  height = 4.2
  lookAhead = 18
  fovBase = 72
  fovMaxBoost = 18

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
    // slight lateral shift opposite steer to enhance sense of drift
    const right = new THREE.Vector3().crossVectors(t, new THREE.Vector3(0,1,0)).normalize().multiplyScalar(-1)
    const lateralShift = right.clone().multiplyScalar(steerValue * 1.1)

    this.targetPos.copy(vehPos).add(behind).add(up).add(lateralShift)

    // spring-damper integration (explicit)
    // accel = (target - pos)*stiffness - vel*damping
    const accel = this.targetPos.clone().sub(this.pos).multiplyScalar(this.stiffness)
    accel.add(this.vel.clone().multiplyScalar(-this.damping))
    this.vel.addScaledVector(accel, dt)
    this.pos.addScaledVector(this.vel, dt)

    this.camera.position.copy(this.pos)

    // look ahead along road
    const aheadPos = vehPos.clone().add(t.clone().multiplyScalar(this.lookAhead))
    aheadPos.y += 0.6
    // smooth lookAt
    this.lookAt.lerp(aheadPos, 1 - Math.exp(-6 * dt))
    this.camera.lookAt(this.lookAt)

    // camera roll on curves (tilt Z) – we rotate camera after lookAt via manual roll
    const targetRoll = -steerValue * 0.22 - (t.x * 0.08) // steer + curvature
    this.roll = THREE.MathUtils.lerp(this.roll, targetRoll, 1 - Math.exp(-2.8 * dt))
    // apply roll by rotating camera around its forward axis
    // Three's camera up adjustment: we can rotate on Z after lookAt
    this.camera.rotation.z = this.roll

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
