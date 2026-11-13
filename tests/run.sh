#!/usr/bin/env bash
# The two checks, and the window nobody sees that drives the real form.
#
#   BINTANA=/path/to/build/bintana tests/run.sh
#
# `bintana` on the PATH is the default, which is what a checkout of the runtime
# installs and what the README presumes.
set -euo pipefail
cd "$(dirname "$0")/.."

BINTANA=${BINTANA:-bintana}

"$BINTANA" check --strict .
"$BINTANA" check --strict tests/selfcheck
exec xvfb-run -a "$BINTANA" tests/selfcheck "$@"
