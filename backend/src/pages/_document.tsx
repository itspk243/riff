// Custom Document — adds the PostHog analytics tags to every Next.js
// SSR'd page (dashboard, signup, auth callback, etc). The static
// public/*.html pages embed the same meta + script directly.
//
// The PostHog public key is meant to live on the client. We read it from
// NEXT_PUBLIC_POSTHOG_KEY at build time. If the env var is unset, we
// still emit the meta tag with a placeholder, and analytics.js no-ops.
//
// The host defaults to us.i.posthog.com (PostHog Cloud US). Override via
// NEXT_PUBLIC_POSTHOG_HOST if you self-host or use the EU cluster.

import { Html, Head, Main, NextScript } from 'next/document';

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || 'phc_qGNvqYvTcMpLhKikzCmckAetNEKX9dLRv6YJEDXpR3h7';
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta name="riff-posthog-key" content={POSTHOG_KEY} />
        <meta name="riff-posthog-host" content={POSTHOG_HOST} />
        <script src="/analytics.js" defer />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
