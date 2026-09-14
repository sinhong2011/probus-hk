#!/usr/bin/env bash
# Bring up WebDAV (hacdias) and S3 (LocalStack) on the home server.
#
# Bind mounts go to $ROGDISK/probus/{webdav,s3}. Docker named volumes are
# not used: the backup has to survive a compose down.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/dev/home-server"
ROGDISK="${ROGDISK:-/rogdisk}"
export ROGDISK

mkdir -p "$ROGDISK/probus/webdav" "$ROGDISK/probus/s3"

if [ ! -f "$dir/.env" ] && [ -f "$dir/.env.example" ]; then
  cp "$dir/.env.example" "$dir/.env"
  echo "Wrote $dir/.env from the example - change WEBDAV_PASSWORD before this is on a network."
fi

cd "$dir"
docker compose up -d "$@"
echo
echo "WebDAV  http://<this-host>:6065/   (user/password from $dir/.env)"
echo "S3      http://<this-host>:4566    bucket probus, keys test / test, path-style on"
echo "Files   $ROGDISK/probus/webdav  and  $ROGDISK/probus/s3"
