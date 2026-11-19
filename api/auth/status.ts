// DROP — Vercel serverless function: auth status.
// GET /api/auth/status → { googleConfigured, dbConfigured, phoneConfigured: false }
// Phone + OTP is disabled (2026-11-19), so phoneConfigured is always
// false. dbConfigured is true only when DATABASE_URL (Neon) is set —
// it says whether a shared user count exists, not how many users.
// No secrets are returned — only booleans.

export default function handler(_req: any, res: any): void {
  res.status(200).json({
    googleConfigured: Boolean(process.env.DROP_GOOGLE_CLIENT_ID),
    dbConfigured: Boolean(process.env.DATABASE_URL),
    phoneConfigured: false,
  });
}
