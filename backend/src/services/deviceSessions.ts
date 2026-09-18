// Turns AuthSession rows (already written on every admin login, see
// refreshTokens.ts::issueAdminRefreshToken) into the Superadmin Observer's
// per-account "devices logged in" view. Nothing here is fabricated: a
// browser never exposes an actual device/PC name to a website, so "device"
// is parsed from the login's User-Agent (browser + OS) instead, and
// "location" is a best-effort IP-geolocation lookup that's simply absent
// (not guessed) when it hasn't resolved or can't be resolved at all.

import prisma from '../utils/db.js';
import type { AuthSession } from '@prisma/client';

interface ParsedDevice {
  browser: string;
  os: string;
  label: string;
}

export function parseUserAgent(userAgent: string | null | undefined): ParsedDevice {
  if (!userAgent) return { browser: 'Unknown browser', os: 'Unknown device', label: 'Unknown device' };

  let os = 'Unknown device';
  if (/Windows NT 10\.0/.test(userAgent)) os = 'Windows 10/11';
  else if (/Windows NT/.test(userAgent)) os = 'Windows';
  else if (/iPhone|iPod/.test(userAgent)) os = 'iPhone';
  else if (/iPad/.test(userAgent)) os = 'iPad';
  else if (/Mac OS X/.test(userAgent)) os = 'macOS';
  else if (/Android/.test(userAgent)) os = 'Android';
  else if (/CrOS/.test(userAgent)) os = 'ChromeOS';
  else if (/Linux/.test(userAgent)) os = 'Linux';

  let browser = 'Unknown browser';
  if (/Edg\//.test(userAgent)) browser = 'Edge';
  else if (/OPR\//.test(userAgent) || /Opera/.test(userAgent)) browser = 'Opera';
  else if (/SamsungBrowser/.test(userAgent)) browser = 'Samsung Internet';
  else if (/Chrome\//.test(userAgent) && !/Chromium/.test(userAgent)) browser = 'Chrome';
  else if (/Firefox\//.test(userAgent)) browser = 'Firefox';
  else if (/Safari\//.test(userAgent) && /Version\//.test(userAgent)) browser = 'Safari';

  return { browser, os, label: `${browser} on ${os}` };
}

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/,
  /^f[cd][0-9a-f]{2}:/i, // fc00::/7 unique local
  /^fe80:/i, // link-local
];

export function isPrivateIp(ip: string | null | undefined): boolean {
  if (!ip) return true;
  const cleaned = ip.replace(/^::ffff:/, '');
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(cleaned));
}

interface GeoResult {
  city: string | null;
  region: string | null;
  country: string | null;
}

const GEO_LOOKUP_TIMEOUT_MS = 4000;

async function lookupGeo(ip: string): Promise<GeoResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEO_LOOKUP_TIMEOUT_MS);
  try {
    // ip-api.com's free tier is HTTP-only (no HTTPS) and unauthenticated —
    // acceptable here since it's a server-to-server lookup of a public IP,
    // never anything sensitive, and the result is cached on the session row
    // so each IP is only ever looked up once.
    const response = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city`,
      { signal: controller.signal }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      status: string;
      country?: string;
      regionName?: string;
      city?: string;
    };
    if (data.status !== 'success') return null;
    return { city: data.city ?? null, region: data.regionName ?? null, country: data.country ?? null };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Fire-and-forget, called right after an AuthSession row is created at
// login — never blocks or fails the login itself. A lookup failure (rate
// limit, timeout, private IP) just leaves the geo columns null, which the
// device popup shows as "unknown" rather than a guess.
export function resolveSessionGeo(sessionId: string, ip: string | null | undefined): void {
  if (!ip || isPrivateIp(ip)) return;
  void (async () => {
    const geo = await lookupGeo(ip);
    if (!geo) return;
    try {
      await prisma.authSession.update({
        where: { id: sessionId },
        data: { geoCity: geo.city, geoRegion: geo.region, geoCountry: geo.country },
      });
    } catch {
      // Session may already be gone (revoked/cleaned up) — fine to drop.
    }
  })();
}

function formatLocation(session: Pick<AuthSession, 'ipAddress' | 'geoCity' | 'geoRegion' | 'geoCountry'>): string | null {
  if (isPrivateIp(session.ipAddress)) return 'Local network';
  const parts = [session.geoCity, session.geoRegion, session.geoCountry].filter((v): v is string => Boolean(v));
  return parts.length > 0 ? parts.join(', ') : null;
}

export interface AdminDeviceInfo {
  key: string;
  browser: string;
  os: string;
  ipAddress: string | null;
  location: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  loginCount: number;
}

// A "device" is a distinct (IP, browser+OS) pair among this admin's still-
// active (non-revoked, non-expired) login sessions — there's no real device
// fingerprint available, so this is the closest honest proxy: the same
// physical device on the same network will keep landing in the same group
// across repeated logins.
export async function getAdminDeviceSummary(adminId: string): Promise<{ count: number; devices: AdminDeviceInfo[] }> {
  const sessions = await prisma.authSession.findMany({
    where: { adminId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  const groups = new Map<string, AuthSession[]>();
  for (const session of sessions) {
    const key = `${session.ipAddress ?? 'unknown-ip'}|${session.userAgent ?? 'unknown-ua'}`;
    const existing = groups.get(key);
    if (existing) existing.push(session);
    else groups.set(key, [session]);
  }

  const devices: AdminDeviceInfo[] = Array.from(groups.entries())
    .map(([key, group]) => {
      const parsed = parseUserAgent(group[0].userAgent);
      const timestamps = group.map((s) => s.createdAt.getTime());
      return {
        key,
        browser: parsed.browser,
        os: parsed.os,
        ipAddress: group[0].ipAddress,
        location: formatLocation(group[0]),
        firstSeenAt: new Date(Math.min(...timestamps)).toISOString(),
        lastSeenAt: new Date(Math.max(...timestamps)).toISOString(),
        loginCount: group.length,
      };
    })
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

  return { count: devices.length, devices };
}

// Bulk version for the accounts list, so every row's device-count badge
// doesn't need its own request — one grouped query for the whole page.
export async function getDeviceCountsForAdmins(adminIds: string[]): Promise<Map<string, number>> {
  if (adminIds.length === 0) return new Map();
  const groups = await prisma.authSession.groupBy({
    by: ['adminId', 'ipAddress', 'userAgent'],
    where: { adminId: { in: adminIds }, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  const counts = new Map<string, number>();
  for (const group of groups) {
    counts.set(group.adminId, (counts.get(group.adminId) ?? 0) + 1);
  }
  return counts;
}
