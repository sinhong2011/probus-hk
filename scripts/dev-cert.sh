#!/usr/bin/env bash
# Generates the certificate the dev server serves HTTPS with.
#
# mkcert is preferred: it installs a local authority, so the phone and the
# laptop both trust the result and no browser warning stands between a rider
# and the app. Without mkcert this falls back to a self-signed pair, which
# works but has to be accepted once per device.
set -euo pipefail

dir="$(cd "$(dirname "$0")/.." && pwd)/.certs"
mkdir -p "$dir"

# Every address the app might be opened from: the machine itself, and its
# address on the local network.
lan="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")"
names=(localhost 127.0.0.1 ::1)
[ -n "$lan" ] && names+=("$lan")

if command -v mkcert >/dev/null 2>&1; then
  mkcert -install
  mkcert -key-file "$dir/dev-key.pem" -cert-file "$dir/dev.pem" "${names[@]}"
else
  echo "mkcert not found - falling back to a self-signed certificate."
  echo "  brew install mkcert   # for one your devices will trust"
  alt="DNS:localhost,IP:127.0.0.1,IP:::1"
  [ -n "$lan" ] && alt="$alt,IP:$lan"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
    -keyout "$dir/dev-key.pem" -out "$dir/dev.pem" \
    -subj "/CN=motherbus.local" -addext "subjectAltName=$alt"
fi

echo
echo "Certificate written to .certs - run 'npm run dev' and it will serve HTTPS."
[ -n "$lan" ] && echo "On a phone: https://$lan:5173"
