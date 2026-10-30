#!/usr/bin/env bash
# Sync master (company email) to gh-main (personal email) and push to GitHub.
# Usage: ./scripts/sync-github.sh
set -euo pipefail

# 0. Stash any local changes so filter-branch can run.
if ! git diff-index --quiet HEAD --; then
  git stash push -q -m "sync-github auto-stash" --include-untracked
  trap 'git stash pop -q' EXIT
fi

# 1. Rebuild gh-main from master with the personal identity.
#    (rebase --exec skips the rewrite on fast-forward, so filter-branch is used.)
git branch -f gh-main master
git filter-branch -f --env-filter '
  export GIT_AUTHOR_NAME="l5ng"
  export GIT_AUTHOR_EMAIL="nooralu@foxmail.com"
  export GIT_COMMITTER_NAME="l5ng"
  export GIT_COMMITTER_EMAIL="nooralu@foxmail.com"
' -- refs/heads/gh-main 2>/dev/null

# 2. Push to GitHub.
git push --force github gh-main:master
echo "Synced to https://github.com/l5ng/listen-up"
