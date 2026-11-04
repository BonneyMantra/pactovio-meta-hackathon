#!/usr/bin/env bash
# Repository guards run in CI before typecheck and tests. Each prints what it checks; any failure exits non-zero.
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

check "LICENSE present and MIT" '[ -f LICENSE ] && grep -q "MIT License" LICENSE'
check "CODEOWNERS present" '[ -f .github/CODEOWNERS ]'
check "no env or dev-vars files tracked" '! git ls-files | grep -E "(^|/)(\.env(\.local)?|\.dev\.vars)$"'
check "no contributor-mode model in lane config" '! grep -iE "^(LANE|MODEL)_[A-Z]+ *=.*contributor" apps/api/wrangler.toml'
check "every production lane is on the Meta provider" '! grep -E "^LANE_[A-Z]+ *=" apps/api/wrangler.toml | grep -v "\"meta:"'
check "no token-shaped secrets in tracked files" '! git grep -nIE "(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16})" -- . ":(exclude)package-lock.json"'
check "package scripts never target the retired pactovio stack" '! grep -qhE "project-name pactovio\"|project-name pactovio |d1 [a-z ]+ pactovio " apps/*/package.json'

exit $fail
