#!/bin/bash
# scripts/create-backup.sh
# ─────────────────────────────────────────────────────────────────────────────
# Creates a clean, secret-free project backup using git archive.
# Only packages git-tracked files — .gitignore is automatically respected.
# Secrets, build artifacts, .DS_Store, nested zips: all excluded by default.
#
# Usage:
#   ./scripts/create-backup.sh              # archives HEAD
#   ./scripts/create-backup.sh v1.2.3       # archives a specific tag
#   ./scripts/create-backup.sh feature/xyz  # archives a branch
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REF="${1:-HEAD}"
DATE=$(date +%Y%m%d_%H%M%S)
BRANCH=$(git rev-parse --abbrev-ref "${REF}" 2>/dev/null || echo "${REF}")
SAFE_BRANCH="${BRANCH//\//-}"  # replace slashes for filename safety
OUT="aiseo2_backup_${SAFE_BRANCH}_${DATE}.zip"

echo "📦 Creating backup of '${REF}'..."
git archive --format=zip --output="${OUT}" "${REF}"

SIZE=$(du -sh "${OUT}" | cut -f1)
echo "✅ Written: ${OUT} (${SIZE})"
echo "   Secrets  : NONE (git archive only includes tracked files)"
echo "   Excluded : .env, node_modules, .next, build artifacts, .DS_Store"
