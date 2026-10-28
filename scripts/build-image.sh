#!/usr/bin/env bash
set -euo pipefail

# Build all project images using the tag from the top-level VERSION file.
# Usage: ./scripts/build-image.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
VERSION_FILE="${ROOT_DIR}/VERSION"

if [ ! -f "${VERSION_FILE}" ]; then
  echo "ERROR: VERSION file not found at ${VERSION_FILE}" >&2
  exit 1
fi

VERSION=$(tr -d ' \n\r' < "${VERSION_FILE}")
if [ -z "${VERSION}" ]; then
  echo "ERROR: VERSION file is empty" >&2
  exit 1
fi

IMAGE_NAME="plannertool:${VERSION}"
AUTH_IMAGE_NAME="plannertool-auth:${VERSION}"

echo "Building image ${IMAGE_NAME} (also tagging as plannertool:latest)"
docker build -f "${ROOT_DIR}/docker/Dockerfile" -t "${IMAGE_NAME}" -t "plannertool:latest" "${ROOT_DIR}"

echo "Building image ${AUTH_IMAGE_NAME} (also tagging as plannertool-auth:latest)"
docker build -f "${ROOT_DIR}/entra-id/Dockerfile" -t "${AUTH_IMAGE_NAME}" -t "plannertool-auth:latest" "${ROOT_DIR}/entra-id"

echo "Build complete: ${IMAGE_NAME}, ${AUTH_IMAGE_NAME}"
