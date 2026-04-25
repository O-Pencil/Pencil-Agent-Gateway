#!/usr/bin/env bash
set -euo pipefail

# Grub harness startup for Pencil Agent Gateway
# This script runs at the beginning of every iteration to verify the project still boots.

echo "=== grub bearings ==="
pwd
echo "--- recent commits ---"
git log --oneline -n 20 2>/dev/null || true
echo "--- working tree ---"
git status --short 2>/dev/null || true
echo "--- progress tail ---"
tail -n 40 "/Users/cl/Project/Pencil-Agent-Gateway/.grub/0290c3bd/progress-log.md" 2>/dev/null || true
echo "--- feature progress ---"
node -e "try{const l=require('/Users/cl/Project/Pencil-Agent-Gateway/.grub/0290c3bd/feature-list.json');const p=l.features.filter(f=>f.passes).length;console.log(p+'/'+l.features.length+' passing');}catch(e){console.log('feature-list.json unavailable');}" 2>/dev/null || true
echo "--- project smoke: TypeScript check ---"
cd /Users/cl/Project/Pencil-Agent-Gateway
npm run typecheck 2>&1 || echo "typecheck failed (may be expected during development)"
echo "--- project smoke: test run ---"
npm run test:run 2>&1 || echo "tests failed (may be expected during development)"
echo "=== bearings complete ==="
