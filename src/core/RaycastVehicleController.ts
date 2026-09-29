import * as THREE from 'three'
import * as CANNON from 'cannon-es'

// Raycast RC Car — clonado de icurtis1/raycast-vehicle (MIT) adaptado a CYBERDRIVE procedural
// Usa CANNON.RaycastVehicle con chassis Box + 4 esferas en esquinas para trimesh (como original)

const CHASSIS_SIZE = { x: 1.78, y: 0.52, z: 3.9 }
const PHYSICS_HALF = { x: 0.88, y: 0.28, z: 1.52 }
const CHASSIS_LIFT = 0.48
const WHEEL_RADIUS = 0.39
const WHEEL_WIDTH = 0.32
const WHEEL_CONNECTION = { x: 0.92, y: 0.32, z: 1.45 }

export const RAYCAST_DEFAULTS = {
  engineForce: 1450,
  boostMultiplier: 1.75,
  cruiseSpeedKmh: 88,
  maxSpeedKmh: 138,
  reverseFactor: 0.58,
  maxSteer: 0.54,
  steerSpeed: 5.8,
  brakeForce: 22,
  handbrakeForce: 34,
  jumpImpulse: 1950,
  airborneGravityScale: 2.1,
  suspensionStiffness: 68,
  suspensionRestLength: 0.52,
  maxSuspensionTravel: 0.40,
  frictionSlip: 7.6,
  dampingRelaxation: 3.4,
  dampingCompression: 4.2,
  mass: 248,
  angularDamping: 0.11,
  inertiaScale: 3.1,
}

export class RaycastVehicleController {
  scene: THREE.Scene
  world: CANNON.World
  chassisBody!: CANNON.Body
  raycastVehicle!: CANNON.RaycastVehicle
  group = new THREE.Group() // visual root synced to chassis
  // para HUD
  get speedKmh() { return this.chassisBody ? this.chassisBody.velocity.length() * 3.6 : 0 }
  get progress() { return this.chassisBody ? this.chassisBody.position.z : 6 }
  get lateral() {
    if (!this.chassisBody) return 0
    // distancia lateral al centro de pista
    const z = this.chassisBody.position.z
    const cx = roadCenterX(z)
    return this.chassisBody.position.x - cx
  }
  params = { ...RAYCAST_DEFAULTS }
  // ruedas visuales (para spin/steer)
  private wheelVisuals: THREE.Group[] = []
  private bodyVisual: THREE.Group | null = null
  private tmpVec = new CANNON.Vec3()
  private tmpQuat = new CANNON.Quaternion()
  private currentSteer = 0
  private chassisMaterial!: CANNON.Material
  private input = { fwd:false, back:false, left:false, right:false, boost:false, brake:false, handbrake:false }
  private spawnPos = new CANNON.Vec3(0, 2.5, 6)
  private spawnQuat = new CANNON.Quaternion()

  private wheelMeshes: THREE.Group[] = []
  private wheelBodies: THREE.Group[] = []
  constructor(scene: THREE.Scene, world: CANNON.World) {
    this.scene = scene
    this.world = world
    this._createPhysics()
    this._createWheelVisuals()
    this.scene.add(this.group)
  }

  setVisuals(body: THREE.Group, frontWheels: THREE.Object3D[], rearWheels: THREE.Object3D[]) {
    // body ya está en vehicleGroup, lo movemos a nuestro group visual
    // frontWheels/rearWheels se sincronizan vía _syncVisuals, pero si son meshes del GLB los dejamos como hijos del group
    this.bodyVisual = body
    // no necesitamos frontWheels separados, el sync usa this.group + wheelVisuals internos
    // pero guardamos para compatibilidad
  }

  private _createPhysics() {
    const p = this.params
    this.chassisMaterial = new CANNON.Material('chassis')
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.chassisMaterial, this.world.defaultMaterial, { friction: 0.015, restitution: 0 }))

    const chassisShape = new CANNON.Box(new CANNON.Vec3(PHYSICS_HALF.x, PHYSICS_HALF.y, PHYSICS_HALF.z))
    this.chassisBody = new CANNON.Body({ mass: p.mass, material: this.chassisMaterial })
    this.chassisBody.addShape(chassisShape, new CANNON.Vec3(0, CHASSIS_LIFT, 0))
    const r = PHYSICS_HALF.y
    const cx = PHYSICS_HALF.x - r
    const cz = PHYSICS_HALF.z - r
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this.chassisBody.addShape(new CANNON.Sphere(r), new CANNON.Vec3(sx*cx, CHASSIS_LIFT, sz*cz))
    }
    this.chassisBody.position.copy(this.spawnPos)
    this.chassisBody.quaternion.copy(this.spawnQuat)
    this.chassisBody.angularDamping = p.angularDamping
    this.chassisBody.allowSleep = false

    this.raycastVehicle = new CANNON.RaycastVehicle({ chassisBody: this.chassisBody, indexRightAxis:0, indexUpAxis:1, indexForwardAxis:2 })
    const wheelOpts = {
      radius: WHEEL_RADIUS,
      directionLocal: new CANNON.Vec3(0,-1,0),
      suspensionStiffness: p.suspensionStiffness,
      suspensionRestLength: p.suspensionRestLength,
      frictionSlip: p.frictionSlip,
      dampingRelaxation: p.dampingRelaxation,
      dampingCompression: p.dampingCompression,
      maxSuspensionForce: 100000,
      rollInfluence: 0.009,
      axleLocal: new CANNON.Vec3(1,0,0),
      maxSuspensionTravel: p.maxSuspensionTravel,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
    }
    const { x,y,z } = WHEEL_CONNECTION
    const points = [new CANNON.Vec3(-x,y,z), new CANNON.Vec3(x,y,z), new CANNON.Vec3(-x,y,-z), new CANNON.Vec3(x,y,-z)]
    for (const pt of points) this.raycastVehicle.addWheel({ ...wheelOpts, chassisConnectionPointLocal: pt })
    this.raycastVehicle.addToWorld(this.world)
    this.applyParams()
  }

  private _createWheelVisuals() {
    const wheelGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24)
    wheelGeo.rotateZ(Math.PI/2)
    const mat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 })
    for (let i=0;i<4;i++) {
      const g = new THREE.Group()
      const tire = new THREE.Mesh(wheelGeo, mat)
      tire.castShadow = true
      g.add(tire)
      this.group.add(g)
      this.wheelMeshes.push(g)
    }
  }

  applyParams() {
    const p=this.params
    const b=this.chassisBody
    b.mass=p.mass; b.angularDamping=p.angularDamping; b.updateMassProperties()
    b.inertia.x*=p.inertiaScale; b.inertia.z*=p.inertiaScale
    b.invInertia.set(b.inertia.x?1/b.inertia.x:0, b.inertia.y?1/b.inertia.y:0, b.inertia.z?1/b.inertia.z:0)
    b.updateInertiaWorld(true)
    for (const w of this.raycastVehicle.wheelInfos) {
      w.suspensionStiffness=p.suspensionStiffness; w.suspensionRestLength=p.suspensionRestLength
      w.maxSuspensionTravel=p.maxSuspensionTravel; w.frictionSlip=p.frictionSlip
      w.dampingRelaxation=p.dampingRelaxation; w.dampingCompression=p.dampingCompression
    }
  }

  handleInput(input: { accel:number, steer:number, brake:boolean }) {
    // input.accel -1..1 (W/S), steer -1..1 (A/D)
    this.input.fwd = input.accel > 0.12
    this.input.back = input.accel < -0.12
    this.input.left = input.steer < -0.08
    this.input.right = input.steer > 0.08
    this.input.boost = false
    this.input.handbrake = input.brake
    // ejes continuos
    ;(this.input as any).throttleAxis = input.accel
    ;(this.input as any).steerAxis = input.steer
  }

  update(dt: number) {
    // steering
    const p=this.params
    const steerInput = (this.input as any).steerAxis ?? ((this.input.right?1:0)+(this.input.left?-1:0))
    const targetSteer = -steerInput * p.maxSteer
    const steerDelta = p.steerSpeed * dt
    this.currentSteer = THREE.MathUtils.clamp(targetSteer, this.currentSteer - steerDelta, this.currentSteer + steerDelta)
    this.raycastVehicle.setSteeringValue(this.currentSteer, 0)
    this.raycastVehicle.setSteeringValue(this.currentSteer, 1)

    // engine
    const speed = this.speedKmh
    const boosting = this.input.boost
    const cap = boosting ? p.maxSpeedKmh : p.cruiseSpeedKmh
    const throttleAxis = (this.input as any).throttleAxis ?? 0
    const throttleInput = Math.abs(throttleAxis) > 0.05 ? throttleAxis : ((this.input.fwd?1:0)+(this.input.back?-1:0))
    const fwd = throttleInput > 0.05
    const back = throttleInput < -0.05
    let force = 0
    if (fwd && speed < cap) force = -p.engineForce * (boosting? p.boostMultiplier:1) * Math.min(1, Math.abs(throttleInput))
    else if (back) {
      const movingFwd = this.chassisBody.velocity.dot(this._forwardDir()) > 0.5
      force = movingFwd ? 0 : p.engineForce * p.reverseFactor * Math.min(1, Math.abs(throttleInput))
    }
    this.raycastVehicle.applyEngineForce(force, 2)
    this.raycastVehicle.applyEngineForce(force, 3)

    // brakes
    let brake = 0
    if (back && this.chassisBody.velocity.dot(this._forwardDir()) > 0.5) brake = p.brakeForce
    if (!fwd && !back) brake = 1.2
    for (let i=0;i<4;i++) this.raycastVehicle.setBrake(brake,i)
    if (this.input.handbrake) { this.raycastVehicle.setBrake(p.handbrakeForce,2); this.raycastVehicle.setBrake(p.handbrakeForce,3) }

    if (this.chassisBody.position.y < -18) this.reset()
  }

  private _forwardDir() {
    const dir = new CANNON.Vec3()
    this.chassisBody.quaternion.vmult(new CANNON.Vec3(0,0,1), dir)
    return dir
  }

  reset() {
    this.chassisBody.position.copy(this.spawnPos)
    this.chassisBody.quaternion.copy(this.spawnQuat)
    this.chassisBody.velocity.setZero()
    this.chassisBody.angularVelocity.setZero()
  }

  syncVisuals() {
    this.group.position.copy(this.chassisBody.position as unknown as THREE.Vector3)
    this.group.quaternion.copy(this.chassisBody.quaternion as unknown as THREE.Quaternion)
    // ruedas: sincroniza visuales con física (como original)
    for (let i=0;i<4;i++) {
      this.raycastVehicle.updateWheelTransform(i)
      const t = this.raycastVehicle.wheelInfos[i].worldTransform
      // convertir a local del chasis
      this.chassisBody.pointToLocalFrame(t.position, this.tmpVec as any)
      // si está en aire, usar posición de reposo
      if (!this.raycastVehicle.wheelInfos[i].isInContact) {
        const ci = this.raycastVehicle.wheelInfos[i].chassisConnectionPointLocal
        const dir = this.raycastVehicle.wheelInfos[i].directionLocal
        this.tmpVec.copy(ci as any)
        this.tmpVec.vadd(dir.scale(this.raycastVehicle.wheelInfos[i].suspensionRestLength) as any, this.tmpVec as any)
      }
      this.wheelMeshes[i].position.copy(this.tmpVec as unknown as THREE.Vector3)
      // rotación de la rueda (spin + steer ya está en worldTransform)
      const q = t.quaternion
      // convertir a local
      const inv = this.chassisBody.quaternion.clone().conjugate() as any
      const localQ = inv.mult(q) as any
      this.wheelMeshes[i].quaternion.copy(localQ as unknown as THREE.Quaternion)
    }
  }

  // trimesh helper
  static createTrimeshBody(geo: THREE.BufferGeometry, world: CANNON.World): CANNON.Body {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const idx = geo.getIndex()
    if (!idx) throw new Error('Trimesh needs index')
    const verts = pos.array as Float32Array
    const indices = idx.array as any
    const shape = new CANNON.Trimesh(verts as unknown as number[], indices as unknown as number[])
    const body = new CANNON.Body({ mass: 0 })
    body.addShape(shape)
    body.position.set(0,0,0)
    // importante: actualizar AABB
    body.updateAABB()
    world.addBody(body)
    return body
  }
}

function roadCenterX(z:number){ return Math.sin(z*0.0030+1.337)*42 + Math.sin(z*0.0011+1.7)*24 + Math.cos(z*0.00062+0.9)*18 + Math.sin(z*0.0055+2.3)*5.5 }
