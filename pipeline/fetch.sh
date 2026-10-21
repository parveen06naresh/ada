#!/usr/bin/env bash
# Shallow-clone the public trackers Frontier reads. Usage: pipeline/fetch.sh [dir]
set -euo pipefail
dir="${1:-.sources}"
mkdir -p "$dir"
for repo in SimplifyJobs/Summer2027-Internships SimplifyJobs/New-Grad-Positions \
            vanshb03/Summer2027-Internships speedyapply/2027-AI-College-Jobs; do
  dest="$dir/${repo/\//_}"
  if [ -d "$dest/.git" ]; then
    git -C "$dest" pull -q --depth 1 || echo "warn: could not update $repo"
  else
    git clone -q --depth 1 "https://github.com/$repo.git" "$dest" || echo "warn: could not clone $repo"
  fi
done
