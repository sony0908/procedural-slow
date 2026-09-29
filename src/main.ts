import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { CyberChunkManager } from './world/CyberChunkManager'
import { RaycastVehicleController } from './core/RaycastVehicleController'
import { CameraRig } from './core/CameraRig'
import { roadCenter } from './world/Road'

// DOM
const canvas = document.getElementById('game') as HTMLCanvasElement
const overlay = document.getElementById('overlay')!
const speedValEl = document.getElementById('speedVal')!
const fpsEl = document.getElementById('fpsHud')!
const minimap = document.getElementById('minimap') as HTMLCanvasElement
const mctx = minimap.getContext('2d')!
const noticeEl = document.getElementById('notice')!
function showNotice(t:string,ms=2400){ noticeEl.textContent=t; noticeEl.classList.add('show'); setTimeout(()=>noticeEl.classList.remove('show'),ms) }

// Renderer/Scene
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.55
renderer.setPixelRatio(Math.min(devicePixelRatio,1.65))
renderer.setClearColor(0x020208,1)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x020208)
scene.fog = new THREE.FogExp2(0x020208, 0.0042)
const camera = new THREE.PerspectiveCamera(68, innerWidth/innerHeight, 0.1, 1400)
camera.position.set(0,3.2,-8)
scene.add(new THREE.HemisphereLight(0xd8e8ff,0x1e1e3a,1.55))
const sun = new THREE.DirectionalLight(0xfff6e0,3.6); sun.position.set(-30,55,-18); scene.add(sun)
const sun2 = new THREE.DirectionalLight(0xb8d6ff,1.6); sun2.position.set(35,40,22); scene.add(sun2)
scene.add(new THREE.PointLight(0x00ffff,30,38).translateX(0).translateY(6).translateZ(0))
scene.add(new THREE.PointLight(0xff0055,20,30).translateX(0).translateY(3.5).translateZ(-6))
scene.add(new THREE.AmbientLight(0xffffff,0.88))

// Stars
function createStars(){
  const geo=new THREE.BufferGeometry(), cnt=2800, pos=new Float32Array(cnt*3), col=new Float32Array(cnt*3), c=new THREE.Color()
  for(let i=0;i<cnt;i++){ const r=720+Math.random()*420, th=Math.random()*Math.PI*2, ph=Math.acos(2*Math.random()-1)
    const x=r*Math.sin(ph)*Math.cos(th), y=r*Math.cos(ph)*0.55+180, z=r*Math.sin(ph)*Math.sin(th)
    pos[i*3]=x; pos[i*3+1]=Math.max(28,y); pos[i*3+2]=z
    const tint=Math.random(); if(tint<0.68) c.setHSL(0.55+Math.random()*0.04,0.18,0.92); else if(tint<0.84) c.setHSL(0.82,0.22,0.9); else c.setHSL(0.06,0.2,0.94)
    col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3))
  geo.setAttribute('color', new THREE.BufferAttribute(col,3))
  const mat=new THREE.PointsMaterial({ size:1.45, vertexColors:true, transparent:true, opacity:0.98, sizeAttenuation:true, depthWrite:false, blending:THREE.AdditiveBlending })
  ;(mat as any).fog=false
  const pts=new THREE.Points(geo,mat); pts.frustumCulled=false; scene.add(pts); return pts
}
const stars=createStars()

// Physics world — suelo simple infinito (terreno visual se mantiene como antes, sin trimesh)
const world = new CANNON.World({ gravity: new CANNON.Vec3(0,-9.82,0) })
world.broadphase = new CANNON.SAPBroadphase(world)
;(world.solver as any).iterations = 10
world.defaultContactMaterial.friction = 0.9
world.defaultContactMaterial.restitution = 0
// suelo infinito para raycast (y=0.02 coincide con asfalto) — mantiene conducción
const groundShape = new CANNON.Plane()
const groundBody = new CANNON.Body({ mass: 0 })
groundBody.addShape(groundShape)
groundBody.quaternion.setFromEuler(-Math.PI/2, 0, 0)
groundBody.position.set(0, 0.02, 0)
world.addBody(groundBody)

// World chunks visuales (sin física, como pediste: mapa perfecto se mantiene)
const chunkMgr = new CyberChunkManager(scene)

// Vehicle (raycast)
const raycastCtrl = new RaycastVehicleController(scene, world)
raycastCtrl.chassisBody.position.set(0, 0.65, 6)
raycastCtrl.chassisBody.quaternion.set(0,0,0,1)

// Camera rig follows raycast chassis
const camRig = new CameraRig(camera, raycastCtrl.group as any)
camRig.attachDOM(canvas)
camRig.distance = 6.2; camRig.height = 2.4

// GLB Citroën → attach to raycast group
let vehicleMesh: THREE.Group|null=null
const loader=new GLTFLoader(); const draco=new DRACOLoader(); draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/'); loader.setDRACOLoader(draco)
async function loadVehicle(){
  try{
    const gltf=await loader.loadAsync('/assets/models/citroen_ds_survolt.glb')
    const root=gltf.scene
    root.traverse((o:any)=>{ if(o.isMesh){ if(o.material){ const mats=Array.isArray(o.material)?o.material:[o.material]; for(const m of mats){ if(m.map) m.map.colorSpace=THREE.SRGBColorSpace; m.needsUpdate=true } } o.castShadow=false } })
    const box=new THREE.Box3().setFromObject(root), size=box.getSize(new THREE.Vector3())
    const needYaw90=size.x > size.z*1.35
    if(needYaw90){ root.rotation.set(0,Math.PI*0.5,0); root.updateMatrixWorld(true); const b2=new THREE.Box3().setFromObject(root); b2.getSize(size) }
    const s= 3.9 / Math.max(size.x,size.z); root.scale.setScalar(s); root.updateMatrixWorld(true)
    const box2=new THREE.Box3().setFromObject(root); const center=box2.getCenter(new THREE.Vector3()); root.position.sub(center); root.position.y+=0.06; root.position.z+=0.06
    root.rotation.x=0; root.rotation.z=0; root.rotation.y = needYaw90? Math.PI*0.5 : 0
    root.position.y += 0.35
    raycastCtrl.group.add(root)
    vehicleMesh=root
    // ocultar ruedas GLB (usamos placeholder raycast para física visual correcta, evita doble ruedas bugeadas)
    root.traverse((o:any)=>{
      const n=(o.name||'').toLowerCase()
      if(o.isMesh && (n.includes('wheel')||n.includes('tire')||n.includes('rim'))){
        o.visible=false
      }
    })
    // ocultar placeholder si GLB no tiene ruedas visibles, usamos las del raycast (ya creadas)
    showNotice('Citroën DS Survolt + Raycast activo ✓',2000)
  }catch(e){ console.error(e); showNotice('GLB no cargado - placeholder raycast',2000) }
}
loadVehicle()

// Input
const keys=new Set<string>()
addEventListener('keydown',e=>{ keys.add(e.code); if(e.code==='Space') e.preventDefault(); if((e.code==='Enter'||e.code==='NumpadEnter')&&!running) start() })
addEventListener('keyup',e=>keys.delete(e.code))
function getInput(){ let a=0; if(keys.has('KeyW')||keys.has('ArrowUp')) a+=1; if(keys.has('KeyS')||keys.has('ArrowDown')) a-=1; let s=0; if(keys.has('KeyA')||keys.has('ArrowLeft')) s-=1; if(keys.has('KeyD')||keys.has('ArrowRight')) s+=1; return { accel:a, steer:s, brake:keys.has('Space') } }
let touchSteer=0,touchAccel=0
canvas.addEventListener('touchstart',e=>{ const t=e.touches[0]; if(!t) return; const x=t.clientX/innerWidth; touchSteer = x<0.33?-1:x>0.66?1:0; touchAccel = t.clientY/innerHeight<0.5?1:0; e.preventDefault()},{passive:false})
canvas.addEventListener('touchmove',e=>{ const t=e.touches[0]; if(!t) return; const x=t.clientX/innerWidth; touchSteer = x<0.33?-1:x>0.66?1:0; e.preventDefault()},{passive:false})
canvas.addEventListener('touchend',()=>{ touchSteer=0; touchAccel=0 })

let running=false, paused=false
function start(){ if(running) return; running=true; paused=false; overlay.classList.add('hidden'); showNotice('Raycast activo — W/S + A/D + Space',1800) }
document.getElementById('enter')!.addEventListener('click',e=>{ e.stopPropagation(); start() })
overlay.addEventListener('click',e=>{ if((e.target as HTMLElement).id==='overlay') start() })
canvas.addEventListener('click',()=>{ if(!running) start() })
addEventListener('keydown',e=>{ if(e.code==='Escape'&&running){ paused=!paused; if(paused) overlay.classList.remove('hidden'); else overlay.classList.add('hidden') } })

// Minimap
function drawMinimap(progress:number, lateral:number){
  const w=minimap.width,h=minimap.height
  mctx.clearRect(0,0,w,h); mctx.fillStyle='#060610'; mctx.fillRect(0,0,w,h)
  mctx.strokeStyle='rgba(0,255,255,0.08)'; mctx.lineWidth=1
  for(let i=0;i<w;i+=18){ mctx.beginPath(); mctx.moveTo(i,0); mctx.lineTo(i,h); mctx.stroke() }
  for(let i=0;i<h;i+=18){ mctx.beginPath(); mctx.moveTo(0,i); mctx.lineTo(w,i); mctx.stroke() }
  const range=600, behind=120, steps=96, cx=w*0.5, cy=h*0.78, scale=0.16
  mctx.lineWidth=6; mctx.strokeStyle='#0a0a14'; mctx.lineCap='round'; mctx.beginPath()
  for(let i=0;i<=steps;i++){ const t=i/steps, z=THREE.MathUtils.lerp(progress-behind, progress+600, t), rx=roadCenter(z).x, x=cx+rx*scale*4.2, y=cy-(z-progress)*scale; if(i===0) mctx.moveTo(x,y); else mctx.lineTo(x,y) } mctx.stroke()
  mctx.lineWidth=1.7; mctx.strokeStyle='#00ffff'; (mctx as any).shadowColor='#00ffff'; (mctx as any).shadowBlur=6; mctx.beginPath()
  for(let i=0;i<=steps;i++){ const t=i/steps, z=THREE.MathUtils.lerp(progress-behind, progress+600,t), rx=roadCenter(z).x, x=cx+rx*scale*4.2, y=cy-(z-progress)*scale; if(i===0) mctx.moveTo(x,y); else mctx.lineTo(x,y) } mctx.stroke(); (mctx as any).shadowBlur=0
  const rx0=roadCenter(progress).x, vx=cx+(rx0+lateral)*scale*4.2, vy=cy
  mctx.fillStyle='rgba(255,0,85,0.9)'; (mctx as any).shadowColor='#ff0055'; (mctx as any).shadowBlur=10; mctx.beginPath(); mctx.arc(vx,vy,4.2,0,Math.PI*2); mctx.fill(); (mctx as any).shadowBlur=0
  mctx.fillStyle='#fff'; mctx.beginPath(); mctx.arc(vx,vy,1.7,0,Math.PI*2); mctx.fill()
  mctx.fillStyle='rgba(0,255,255,0.9)'; mctx.font='700 8px Share Tech Mono'; mctx.textAlign='left'; mctx.fillText(`${Math.floor(progress)} m`,6,h-6)
  mctx.textAlign='right'; mctx.fillStyle='rgba(255,255,255,0.55)'; mctx.fillText(`${Math.floor(raycastCtrl.speedKmh)} KM/H`,w-6,h-6)
}

// Loop con física fija
let last=performance.now(), fpsAcc=0, fpsCount=0, lastFps=performance.now(), frame=0
const fixedTimeStep=1/60
let accumulator=0
function loop(){
  const now=performance.now(), dt=Math.min((now-last)/1000,0.05); last=now; accumulator+=dt; frame++
  if(!paused){
    const k=getInput(); let a=k.accel, s=k.steer; if(touchAccel!==0) a=touchAccel; if(touchSteer!==0) s=touchSteer
    raycastCtrl.handleInput({ accel:a, steer:s, brake:k.brake })
    // step physics fijo
    while(accumulator >= fixedTimeStep){
      world.step(fixedTimeStep)
      raycastCtrl.update(fixedTimeStep)
      accumulator -= fixedTimeStep
    }
    const prog = raycastCtrl.progress
    const lat = raycastCtrl.lateral
    chunkMgr.update(prog)
    camRig.update(dt, raycastCtrl.speedKmh/3.6, 0, prog) // steer 0 para no duplciar, raycast ya maneja
    stars.position.copy(camera.position); stars.position.y-=80
    const kmh=raycastCtrl.speedKmh; speedValEl.textContent=String(Math.floor(kmh)).padStart(3,'0')
    if(frame%2===0) drawMinimap(prog, lat)
  }
  fpsAcc+=dt; fpsCount++
  if(performance.now()-lastFps>500){ const fps=Math.round(fpsCount/fpsAcc); fpsCount=0; fpsAcc=0; lastFps=performance.now(); const st=chunkMgr.getStats(); fpsEl.textContent=`${fps} FPS • CHUNK ${Math.floor(raycastCtrl.progress/300)} • ${st.loaded} ACTIVOS • ${Math.floor(raycastCtrl.speedKmh)} KM/H` }
  renderer.render(scene,camera)
  requestAnimationFrame(loop)
}
function resize(){ renderer.setSize(innerWidth,innerHeight,false); camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix() }
addEventListener('resize',resize); resize()
chunkMgr.update(6); drawMinimap(6,0); camRig.snap(new THREE.Vector3(0,0.42,6),6); loop()
for(let i=0;i<2;i++) chunkMgr.update(6+i*300)
setTimeout(()=>{ if(!running) showNotice('Pulsa INICIAR MOTORES',2600)},600)
