// DROP — Vercel serverless function: auth status.
// GET /api/auth/status → { googleConfigured, phoneConfigured: false }
// Phone + OTP is disabled (2026-11-19), so phoneConfigured is always
// false. No secrets are returned — only booleans.

export default function handler(_req: any, res: any): void {
  res.status(200).json({
    googleConfigured: Boolean(process.env.DROP_GOOGLE_CLIENT_ID),
    phoneConfigured: false,
  });
}
