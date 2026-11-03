#!/bin/sh
# rig.sh <dir> <atomic-version|none>: fake prefix with a hardlinked node, fake npm/atomic/gh/claude/security/launchctl, real git and stty.
set -e
R="$1"; V="$2"
rm -rf "$R"; mkdir -p "$R/prefix/bin" "$R/bin" "$R/prefix/lib/node_modules/@bastani/atomic" "$R/user" "$R/home"
ln ~/.nvm/versions/node/v26.13.0/bin/node "$R/prefix/bin/node"
w() { printf '#!/bin/sh\necho "$(basename "$0") $*" >> "%s/calls.log"\n%s\n' "$R" "$2" > "$1"; chmod +x "$1"; }
w "$R/prefix/bin/npm" 'echo "FAKE npm: $*"'
w "$R/prefix/bin/atomic" "echo '{\"status\":\"ready\"}'"
w "$R/prefix/bin/claude" "echo '{\"loggedIn\":true,\"authMethod\":\"claude.ai\"}'"
w "$R/prefix/bin/gh" 'exit 0'
w "$R/prefix/bin/security" 'case "$1" in find-generic-password) [ -e "'"$R"'/kc" ];; -i) cat > /dev/null; touch "'"$R"'/kc";; esac'
w "$R/bin/launchctl" 'case "$1" in print) echo "pid = 1";; *) exit 0;; esac'
[ "$V" = none ] || printf '{"version":"%s"}' "$V" > "$R/prefix/lib/node_modules/@bastani/atomic/package.json"
"$R/prefix/bin/node" -e 0
