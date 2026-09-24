export function createLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>()
  return function allow(ip: string, now = Date.now()): boolean {
    const recent = (hits.get(ip) ?? []).filter((time) => now - time < windowMs)
    if (recent.length >= limit) {
      hits.set(ip, recent)
      return false
    }
    recent.push(now)
    hits.set(ip, recent)
    if (hits.size > 5000) {
      for (const [key, times] of hits) {
        if (times.every((time) => now - time >= windowMs)) hits.delete(key)
      }
    }
    return true
  }
}
