// Simple 2D noise (value noise + cubic) with seeded permutation – lightweight, no external dep
export function createNoise2D(seed = 1337) {
  const p = new Uint8Array(512)
  const base = new Uint8Array(256)
  for (let i = 0; i < 256; i++) base[i] = i
  // shuffle with mulberry32
  let a = seed >>> 0
  function rnd() {
    a |= 0; a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const tmp = base[i]; base[i] = base[j]; base[j] = tmp
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255]

  function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10) }
  function lerp(a: number, b: number, t: number) { return a + t * (b - a) }
  function grad(hash: number, x: number, y: number) {
    const h = hash & 7
    const u = h < 4 ? x : y
    const v = h < 4 ? y : x
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v)
  }

  // returns -1 .. 1
  function perlin2D(x: number, y: number): number {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const u = fade(xf)
    const v = fade(yf)
    const aa = p[p[X] + Y]
    const ab = p[p[X] + Y + 1]
    const ba = p[p[X + 1] + Y]
    const bb = p[p[X + 1] + Y + 1]
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u)
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u)
    const r = lerp(x1, x2, v)
    return r // approx -2..2
  }

  // fractal wrapper normalized 0..1
  function noise(x: number, y: number): number {
    let amp = 1, freq = 1, sum = 0, norm = 0
    for (let o = 0; o < 4; o++) {
      sum += perlin2D(x * freq, y * freq) * amp
      norm += amp
      amp *= 0.5; freq *= 2
    }
    const n = sum / norm // -2..2 -> approx -1..1
    return (n + 1) * 0.5 // 0..1
  }

  return { perlin2D, noise }
}
