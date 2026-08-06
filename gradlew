#!/usr/bin/env sh

set -e

APP_HOME=$(cd "$(dirname "$0")" && pwd)
DIST_URL="https://services.gradle.org/distributions/gradle-8.7-bin.zip"
DIST_DIR="$APP_HOME/.gradle-dist"
ZIP_PATH="$DIST_DIR/gradle-8.7-bin.zip"
GRADLE_HOME="$DIST_DIR/gradle-8.7"

mkdir -p "$DIST_DIR"

if [ ! -d "$GRADLE_HOME" ]; then
  echo "Downloading Gradle 8.7..."
  if command -v curl >/dev/null 2>&1; then
    curl -L "$DIST_URL" -o "$ZIP_PATH"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$ZIP_PATH" "$DIST_URL"
  else
    echo "curl or wget is required to download Gradle." >&2
    exit 1
  fi

  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$ZIP_PATH" -d "$DIST_DIR"
  else
    echo "unzip is required to extract Gradle." >&2
    exit 1
  fi
fi

exec "$GRADLE_HOME/bin/gradle" "$@"
