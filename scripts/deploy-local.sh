#!/usr/bin/env bash
#
# Run this ONCE on your local machine. It does the two local-only steps:
#   1. git init + commit + push to your GitHub repo
#   2. Stripe product/coupon setup via the Stripe API
#
# After this finishes, paste the printed price IDs into chat and I (Claude) take
# over the rest from your browser (Vercel deploy, env vars, webhook).
#
# Usage:
#   bash scripts/deploy-local.sh
#
# Requirements: git, node 20.6+, your GitHub repo + Stripe key already configured
# in backend/.env.local.

set -e

# Resolve project root (this script lives at riff/scripts/deploy-local.sh)
RIFF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RIFF_ROOT"

echo "Project root: $RIFF_ROOT"
echo ""

# ---------- Step 1: git push ----------
echo "=== Step 1/2: pushing code to GitHub ==="

if [ ! -d .git ]; then
  git init
  git branch -M main
fi

git add .
if git diff --cached --quiet; then
  echo "  (nothing new to commit)"
else
  git commit -m "deploy: initial commit"
fi

# Reset remote in case it's stale
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/cyberdeviltest88-dot/riff.git"

echo ""
echo "→ Pushing to https://github.com/cyberdeviltest88-dot/riff"
echo "  If git prompts for credentials:"
echo "    Username: cyberdeviltest88-dot"
echo "    Password: a Personal Access Token (PAT), not your GitHub password"
echo "    Generate one at: https://github.com/settings/personal-access-tokens/new"
echo "    Scope: only 'riff' repo, Contents: Read and write"
echo ""

git push -u origin main

echo ""
echo "✓ Code pushed."
echo ""

# ---------- Step 2: Stripe setup ----------
echo "=== Step 2/2: Stripe product + coupon setup ==="

cd backend

if [ ! -f .env.local ]; then
  echo "ERROR: backend/.env.local not found. Cannot read STRIPE_SECRET_KEY."
  exit 1
fi

# Use --env-file if Node 20.6+, otherwise fall back to inline env
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
NODE_MINOR=$(node -p "process.versions.node.split('.')[1]")

if [ "$NODE_MAJOR" -gt 20 ] || ([ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -ge 6 ]); then
  node --env-file=.env.local scripts/setup-stripe.mjs
else
  echo "  (Node $NODE_MAJOR.$NODE_MINOR — using inline env loader)"
  set -a
  source .env.local
  set +a
  node scripts/setup-stripe.mjs
fi

echo ""
echo "============================================================"
echo "✓ All local steps done."
echo ""
echo "Next: paste the two STRIPE_PRICE_*_MONTHLY lines printed above"
echo "into chat, and Claude will take over from there (Vercel deploy)."
echo "============================================================"
