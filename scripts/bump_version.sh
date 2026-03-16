#!/bin/bash
set -e

if [ -z "$1" ]; then
    echo "Current VERSION: $(cat VERSION)"
    echo "Usage: $0 <new-version: 'x.y.z'>"
    exit 1
fi

NEW_VERSION="v$1"

echo "Current version: $(cat VERSION), new version: $NEW_VERSION"
echo "This script will update the VERSION and CHANGELOG.md files and push them."
echo "The CHANGELOG changes update any headers that match '## [v<digit>.<digit>.<digit>] - unreleased' to the current date."
read -p "Proceed? (y/n): " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Version update aborted."
    exit 1
fi

echo $NEW_VERSION > VERSION
# Update VERSION file

# Also update CHANGELOG.md: replace any headers that match
#   ## [v<digit>.<digit>.<digit>] - unreleased
# with the current ISO date (e.g. 2026-03-15). Do not replace the
# template header "## [v] - unreleased".
if [ -f CHANGELOG.md ]; then
    TODAY=$(date -I)
    # Use a regex that matches semantic version headers with digits only
    # and replace the trailing 'unreleased' with the ISO date.
    sed -E -i "s/^(## \[v([0-9]+\.[0-9]+\.[0-9]+)\] - )unreleased$/\1$TODAY/" CHANGELOG.md
    echo "Updated CHANGELOG.md headers from 'unreleased' to '$TODAY' for numbered versions."
    git add CHANGELOG.md
fi

git add VERSION
git commit -m "Bump version to $NEW_VERSION"
git tag -a $NEW_VERSION -m "Release version $NEW_VERSION"
git push origin main --tags
echo "Tag $NEW_VERSION pushed to origin."
