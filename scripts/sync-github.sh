#!/usr/bin/env bash
# Sync master (company email) to gh-main (personal email) and push to GitHub.
# Usage: ./scripts/sync-github.sh
set -euo pipefail

# 1. Rebase gh-main onto master, rewriting new commits to the personal identity.
git checkout gh-main
git rebase master --exec 'git commit --amend --no-edit --author="l5ng <nooralu@foxmail.com>"'

# 2. Push to GitHub.
git push --force-with-lease github gh-main:master

# 3. Back to master.
git checkout master
echo "Synced to https://github.com/l5ng/listen-up"
