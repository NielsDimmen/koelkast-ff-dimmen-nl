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
    rect(x0, y0, x1, y1, color) {
      const left = Math.min(x0, x1)
      const right = Math.max(x0, x1)
      const top = Math.min(y0, y1)
      const bottom = Math.max(y0, y1)
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) api.px(x, y, ...color)
      }
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

function draw(size, { maskable = false, plate = true } = {}) {
  const cabinet = [7, 16, 24, 255]
  const cream = [235, 228, 214, 255]
  const steel = [200, 210, 219, 255]
  const guard = [106, 143, 158, 255]
  const guardDeep = [61, 90, 102, 255]
  const image = canvas(size, size)
  if (maskable || plate) image.fill(...cabinet)
  else image.fill(0, 0, 0, 0)

  const margin = maskable ? size * 0.18 : size * 0.14
  const doorLeft = margin
  const doorTop = margin
  const doorRight = size - margin
  const doorBottom = size - margin * 1.05

  // Cold cabinet frame
  image.rect(doorLeft - size * 0.03, doorTop - size * 0.03, doorRight + size * 0.03, doorBottom + size * 0.03, [19, 32, 44, 255])
  // Cream/steel fridge face
  image.rect(doorLeft, doorTop, doorRight, doorBottom, cream)
  // Steel divider line
  const mid = (doorTop + doorBottom) / 2
  image.rect(doorLeft + size * 0.04, mid - size * 0.01, doorRight - size * 0.04, mid + size * 0.01, steel)
  // Handle
  const handleX = doorRight - size * 0.1
  image.rect(handleX, mid - size * 0.12, handleX + size * 0.035, mid + size * 0.12, guardDeep)
  image.rect(handleX + size * 0.008, mid - size * 0.1, handleX + size * 0.027, mid + size * 0.1, guard)
  // Small guard badge
  const bx = doorLeft + size * 0.12
  const by = doorTop + size * 0.14
  const br = size * 0.055
  image.circle(bx, by, br, guardDeep)
  image.circle(bx, by, br * 0.62, guard)

  // Status signal dots (left / straight / right) — not branding
  const dotY = doorBottom - size * 0.1
  const dotR = Math.max(3, size * 0.04)
  const gap = size * 0.1
  const cx = (doorLeft + doorRight) / 2
  image.circle(cx - gap, dotY, dotR, [25, 163, 74, 255])
  image.circle(cx, dotY, dotR, [255, 122, 0, 255])
  image.circle(cx + gap, dotY, dotR, [225, 6, 0, 255])
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
