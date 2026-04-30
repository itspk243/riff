// Thin Resend HTTP wrapper. We don't use the Resend SDK to avoid an extra
// dependency — the REST API is two fields and a bearer token.
//
// Required env vars:
//   RESEND_API_KEY    — paste from resend.com → API Keys
//   RESEND_FROM       — e.g. "Riffly <digest@rifflylabs.com>" (defaults below)
//
// Domain `rifflylabs.com` must be verified in Resend before live sends will
// land in inboxes.

const RESEND_API = 'https://api.resend.com/emails';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export async function sendEmail(params: SendEmailParams): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { ok: false, error: 'RESEND_API_KEY not set' };
  }
  const from = process.env.RESEND_FROM || 'Riffly <digest@rifflylabs.com>';

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
        reply_to: params.replyTo || 'support@rifflylabs.com',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data?.message || `Resend ${res.status}` };
    }
    return { ok: true, id: data?.id };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'fetch failed' };
  }
}
