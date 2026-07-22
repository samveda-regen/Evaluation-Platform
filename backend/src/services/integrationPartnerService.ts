import jwt from 'jsonwebtoken';
import prisma from '../utils/db.js';
import { decryptSecret } from '../utils/secretEncryption.js';

export interface ResolvedPartner {
  secret: string;
  issuer?: string;
  audience?: string;
}

function envFallback(): ResolvedPartner | null {
  const secret = process.env.RECRUITER_JWT_SECRET || '';
  if (!secret) {
    return null;
  }

  return {
    secret,
    issuer: process.env.RECRUITER_JWT_ISSUER || undefined,
    audience: process.env.RECRUITER_JWT_AUDIENCE || undefined,
  };
}

// Recruiter JWTs are matched to a partner by their `iss` claim so each
// recruitment-platform partner can sign with its own secret instead of every
// integration sharing one set of RECRUITER_JWT_* env vars. Falls back to the
// env-configured single partner when no DB row matches, so existing
// single-tenant setups keep working unchanged.
export async function resolvePartnerForToken(token: string): Promise<ResolvedPartner | null> {
  let issuer: string | undefined;
  try {
    const decoded = jwt.decode(token) as { iss?: string } | null;
    issuer = decoded?.iss;
  } catch {
    issuer = undefined;
  }

  if (issuer) {
    try {
      const partner = await prisma.integrationPartner.findFirst({
        where: { jwtIssuer: issuer, isActive: true },
      });

      if (partner) {
        return {
          secret: decryptSecret(partner.jwtSecret),
          issuer: partner.jwtIssuer ?? undefined,
          audience: partner.jwtAudience ?? undefined,
        };
      }
    } catch (error) {
      console.error('Integration partner lookup failed:', error);
    }
  }

  return envFallback();
}
