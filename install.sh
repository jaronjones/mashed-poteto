#!/bin/sh
set -e
cd "$(dirname "$0")"
[ -d dist ] || node scripts/build.mjs
exec node scripts/install.mjs "$@"
