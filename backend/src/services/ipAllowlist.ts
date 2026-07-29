import prisma from '../utils/db.js';

let cache: { entries: string[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 10_000;

async function getEntries(): Promise<string[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.entries;
  const rows = await prisma.superAdminIpAllowlistEntry.findMany({ select: { cidrOrIp: true } });
  const entries = rows.map((r) => r.cidrOrIp);
  cache = { entries, expiresAt: Date.now() + CACHE_TTL_MS };
  return entries;
}

export function invalidateIpAllowlistCache(): void {
  cache = null;
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function matchesEntry(ip: string, entry: string): boolean {
  if (!entry.includes('/')) return ip === entry;

  const [range, bitsStr] = entry.split('/');
  const bits = Number(bitsStr);
  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  if (ipInt === null || rangeInt === null || !Number.isFinite(bits) || bits < 0 || bits > 32) return false;

  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

// IPv4-only CIDR/exact-IP matcher (no external dependency). Normalizes the
// common IPv4-mapped-IPv6 prefix Node sometimes reports for local/proxied
// connections (::ffff:127.0.0.1).
export async function isIpAllowed(ip: string): Promise<boolean> {
  const entries = await getEntries();
  if (entries.length === 0) return false;

  const normalizedIp = ip.replace('::ffff:', '');
  return entries.some((entry) => matchesEntry(normalizedIp, entry));
}
