#!/usr/bin/env bash
# Whether this run's commit ($GITHUB_SHA) is still the tip of main: deploy.yml asks twice, before the deploy group and
# inside it right before deploying (docs/deploying.md, "How the workflows work").
#   exit 0: it is the tip
#   exit 1: it is not (a notice says so: the newer commit's own run deploys)
#   exit 2: main could not be read (the caller fails: nothing is deployed, and the failure shows)
# Needs GH_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA (set in every Actions job; GH_TOKEN by the step).
set -u
if ! main=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha) || [ -z "$main" ]; then
  echo "::error::could not read the tip of main"
  exit 2
fi
if [ "$main" = "$GITHUB_SHA" ]; then
  exit 0
fi
echo "::notice::main is at $main now, not $GITHUB_SHA: that commit's own run deploys it"
exit 1
