#!/usr/bin/env bash
# Fetch the official Tor Expert Bundle for the given platform and stage
# it at ./tor so electron-builder can ship it via extraResources.
#
#   usage: fetch-tor.sh <os> <arch>      e.g. fetch-tor.sh linux x86_64
#
# Tor (the daemon) is BSD-3-Clause; the bundle also carries OpenSSL /
# libevent / zlib (all permissive). Bundling does NOT affect Wizard's
# own license. We additionally copy THIRD-PARTY-LICENSES.txt into the
# shipped tor/ dir to satisfy the "include the notice" obligation.
set -euo pipefail

OS="${1:?os required (windows|linux)}"
ARCH="${2:?arch required (x86_64)}"
VER="${TOR_BUNDLE_VERSION:?TOR_BUNDLE_VERSION env not set}"

BASE="https://archive.torproject.org/tor-package-archive/torbrowser/${VER}"
FILE="tor-expert-bundle-${OS}-${ARCH}-${VER}.tar.gz"
URL="${BASE}/${FILE}"

echo "Fetching ${URL}"
rm -rf tor tor-bundle.tar.gz
mkdir -p tor

ok=0
for attempt in 1 2 3 4 5; do
  echo "download attempt ${attempt}…"
  if curl -fSL --connect-timeout 20 --max-time 300 -o tor-bundle.tar.gz "${URL}"; then
    ok=1; break
  fi
  echo "attempt ${attempt} failed; retrying in $((attempt * 15))s"
  sleep $((attempt * 15))
done
if [ "${ok}" -ne 1 ]; then
  echo "ERROR: could not download Tor Expert Bundle after 5 attempts"
  exit 1
fi

# The bundle's top-level dir is "tor/" — extract straight into ./tor
tar -xzf tor-bundle.tar.gz
rm -f tor-bundle.tar.gz

BIN="tor/tor"
[ "${OS}" = "windows" ] && BIN="tor/tor.exe"
if [ ! -f "${BIN}" ]; then
  echo "ERROR: ${BIN} not found after extraction. Bundle layout:"
  find tor -maxdepth 2 -type f | head -40
  exit 1
fi
[ "${OS}" != "windows" ] && chmod +x "${BIN}"

# Ship the third-party notices alongside the binary (BSD-3 obligation).
if [ -f THIRD-PARTY-LICENSES.txt ]; then
  cp THIRD-PARTY-LICENSES.txt tor/THIRD-PARTY-LICENSES.txt
fi

echo "Tor ${VER} staged for ${OS}/${ARCH}:"
ls -la tor | head -20
"${BIN}" --version || echo "(version probe skipped — cross-arch/CI sandbox)"
