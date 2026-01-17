#!/bin/bash
set -e

if [ -z "$1" ]; then
    echo "Current VERSION: $(cat VERSION)"
    echo "Usage: $0 <new-version: 'x.y.z'>"
    exit 1
fi

NEW_VERSION=$1

echo "You are about to set the version to: $NEW_VERSION"
read -p "Is this correct? (y/n): " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Version update aborted."
    exit 1
fi

echo $NEW_VERSION > VERSION
git add VERSION
git commit -m "Bump version to $NEW_VERSION"
git tag -a v$NEW_VERSION -m "Release version $NEW_VERSION"
git push origin main --tags
echo "Tag v$NEW_VERSION pushed to origin."
