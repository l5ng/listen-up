#!/usr/bin/env bash
# Sync master (company email) to gh-main (personal email) and push to GitHub.
# Usage: ./scripts/sync-github.sh
set -euo pipefail

NAME="l5ng"
EMAIL="nooralu@foxmail.com"

# 0. Stash any local changes so the history rewrite can run.
if ! git diff-index --quiet HEAD --; then
  git stash push -q -m "sync-github auto-stash" --include-untracked
  trap 'git stash pop -q' EXIT
fi

# 1. Rebuild gh-main from master with the personal identity.
git branch -f gh-main master

if command -v git-filter-repo >/dev/null 2>&1; then
  # Preferred: git-filter-repo (fast, no gotchas).
  git filter-repo --force --identity-callback "
    return (name, email) if email == b'"$EMAIL"' else (b'"$NAME"', b'"$EMAIL"')
  " --refs refs/heads/gh-main
else
  # Fallback: filter-branch (sufficient for linear env-only rewrites).
  FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --env-filter "
    export GIT_AUTHOR_NAME="$NAME"
    export GIT_AUTHOR_EMAIL="$EMAIL"
    export GIT_COMMITTER_NAME="$NAME"
    export GIT_COMMITTER_EMAIL="$EMAIL"
  " -- refs/heads/gh-main 2>/dev/null
fi

# 2. Push to GitHub.
git push --force github gh-main:master
echo "Synced to https://github.com/l5ng/listen-up"
