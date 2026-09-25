# CYBERDRIVE 3D — Synthwave Racing

Juego de carreras 3D HTML5 / WebGL infinito a **60 FPS**, estética **Synthwave / Outrun** (wireframe, neón cyan/magenta, asfalto reflectante, montañas picudas procedimentales), desplegable **estático en Vercel**.

> Inspirado en `slowroads.io` — conducción suave, cinemática, sin motores de física externos.

Vehículo principal: **2010 Citroën DS Survolt** (GLB optimizado + DRACO).

## Demo
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # → dist/ (Vercel static)
npm run preview  # preview del build
```

Vercel: framework **Vite**, output `dist`, install `npm install`, build `npm run build`.

## Stack
- **Three.js 0.160** (ES Modules)
- `GLTFLoader` + `DRACOLoader` (vehículo)
- `CatmullRomCurve3` para spline de carretera
- **Simplex / Perlin 2D + elevación cúbica** `y = pow(noise,3)*92` para montañas
- Sistema vectorial propio `lerp/spring`, `FogExp2(0x020208, 0.008)` para ocultar chunks
- **Vite 5 + TypeScript** — 0 KB física externa

## Módulos (plan opencode)
1. **Escena**: `src/main.ts` — renderer ACES, `FogExp2`, estrellas `Points` (2800), `Hemisphere+Directional`, loader GLB
2. **Carretera**: `src/world/Road.ts` — `roadCenterX/Z` (senos baja frecuencia), `CatmullRomCurve3`, `buildRoadRibbon()` (ancho 14), neón `MeshStandard` emisivo `#FF0055`/`#00FFFF`
3. **Terreno**: `src/world/Terrain.ts` + `src/core/Noise.ts` — `PlaneGeometry` 38×28, noise 4 octavas, `pow³` + **falloff** `clear 11 → fade 34` cerca de pista, `wireframe:true` + `vertexColors` + `flatShading`
4. **Chunks**: `src/world/CyberChunk.ts` + `CyberChunkManager.ts` — `CHUNK_LENGTH=300`, 5 activos `[cur-1 … cur+4]`, `dispose()` de `BufferGeometry`+`Material` para liberar VRAM
5. **Conducción**: `src/core/VehicleController.ts` + `CameraRig.ts` — `lerp` steering, `MathUtils.lerp` pitch/roll/yaw, `lateral` clamp, `CameraRig` spring-damper (`stiffness 22/damping 7.5`), `roll` en curvas + **FOV 72→90** por velocidad
6. **HUD**: `index.html`+`src/main.ts` — velocímetro monospace neón `text-shadow`, minimapa `<canvas>` vectorial (96 segmentos, grid, glow)

## Controles
| Acción | Tecla |
|--------|-------|
| Acelerar | `W` / `↑` |
| Frenar/reversa | `S` / `↓` |
| Girar | `A/D` o `←/→` |
| Freno mano | `Espacio` |
| Pausa | `Esc` |
| Móvil | toque: izquierda/derecha gira, superior acelera |

## Créditos
- **Vehículo**: “2010 Citroën DS Survolt” (https://skfb.ly/pNPRJ) by **Ddiaz Design** — licenciada **CC Attribution-NonCommercial-ShareAlike 4.0** (http://creativecommons.org/licenses/by-nc-sa/4.0/)
- Terreno, carretera y neón: **0 KB assets** — generación 100% por código
- Inspiración conducción: **slowroads.io**

## Performance
- `devicePixelRatio` clamp `1.75`, `renderer.info` monitored, `requestAnimationFrame` dt clamp `0.05`
- Chunk recycling con `dispose()`, fog exponencial como LOD barato
- Objetivo **60 FPS** estable en desktop y móvil

## Estructura
```
src/
  main.ts
  core/Noise.ts / VehicleController.ts / CameraRig.ts
  world/Road.ts / Terrain.ts / CyberChunk.ts / CyberChunkManager.ts
public/assets/models/citroen_ds_survolt.glb
```
