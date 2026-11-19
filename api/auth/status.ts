// DROP — Vercel serverless function: auth status.
// GET /api/auth/status → { googleConfigured, dbConfigured, phoneConfigured: false }
// Phone + OTP is disabled (2026-11-19), so phoneConfigured is always
// false. dbConfigured is true only when DATABASE_URL (Neon) is set —
// it says whether a shared user count exists, not how many users.
// No secrets are returned — only booleans.

export default function handler(_req: any, res: any): void {
  // Same fallback as api/lib/db.ts: the Vercel Neon integration sets
  // POSTGRES_URL / POSTGRES_PRISMA_URL, not DATABASE_URL.
  const dbUrl =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    '';
  res.status(200).json({
    googleConfigured: Boolean(process.env.DROP_GOOGLE_CLIENT_ID),
    dbConfigured: Boolean(dbUrl),
    phoneConfigured: false,
  });
}
