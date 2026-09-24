import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const name = Buffer.from(type)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, crc])
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function canvas(width, height) {
  const data = Buffer.alloc(width * height * 4)
  const api = {
    data,
    fill(r, g, b, a = 255) {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = r
        data[i + 1] = g
        data[i + 2] = b
        data[i + 3] = a
      }
    },
    px(x, y, r, g, b, a = 255) {
      const ix = Math.round(x)
      const iy = Math.round(y)
      if (ix < 0 || iy < 0 || ix >= width || iy >= height) return
      const i = (iy * width + ix) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    },
    circle(cx, cy, radius, color) {
      for (let y = cy - radius; y <= cy + radius; y++) {
        for (let x = cx - radius; x <= cx + radius; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) api.px(x, y, ...color)
        }
      }
    },
  }
  return api
}

function inside(x, y, polygon) {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.00001) + xi
    if (intersect) hit = !hit
  }
  return hit
}

function draw(size, { maskable = false, plate = true } = {}) {
  const image = canvas(size, size)
  if (maskable) image.fill(16, 20, 24, 255)
  else if (!plate) image.fill(0, 0, 0, 0)
  else image.fill(16, 20, 24, 255)

  const margin = maskable ? size * 0.18 : size * 0.12
  const scale = (size - margin * 2) / 100
  const arrow = [
    [50, 8],
    [90, 78],
    [66, 78],
    [50, 48],
    [34, 78],
    [10, 78],
  ].map(([x, y]) => [margin + x * scale, margin + y * scale])

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inside(x, y, arrow)) image.px(x, y, 244, 241, 234, 255)
    }
  }
  const dotY = size * (maskable ? 0.8 : 0.84)
  const dotR = Math.max(3, size * 0.045)
  const gap = size * 0.11
  image.circle(size / 2 - gap, dotY, dotR, [25, 163, 74, 255])
  image.circle(size / 2, dotY, dotR, [255, 122, 0, 255])
  image.circle(size / 2 + gap, dotY, dotR, [225, 6, 0, 255])
  return encodePng(size, size, image.data)
}

const icons = path.join(root, 'koelkast/web/public/icons')
mkdirSync(icons, { recursive: true })
writeFileSync(path.join(root, 'koelkast/icon.png'), draw(128))
writeFileSync(path.join(root, 'koelkast/logo.png'), draw(256, { plate: true }))
writeFileSync(path.join(icons, 'icon-192.png'), draw(192))
writeFileSync(path.join(icons, 'icon-512.png'), draw(512))
writeFileSync(path.join(icons, 'icon-192-maskable.png'), draw(192, { maskable: true }))
writeFileSync(path.join(icons, 'icon-512-maskable.png'), draw(512, { maskable: true }))
writeFileSync(path.join(icons, 'apple-touch-icon.png'), draw(180))
console.log('iconen geschreven')
