# Sourced by dev.sh and spark.sh. Next.js 15 and its tooling need Node 20+. When the system Node is older, use a
# user-local one (NODE_HOME, default ~/.local/opt/node22: the nodejs.org linux tarball unpacked there) so no
# system-wide install is needed.
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
NODE_HOME="${NODE_HOME:-$HOME/.local/opt/node22}"
if (( $(node_major) < 20 )) && [[ -x "$NODE_HOME/bin/node" ]]; then export PATH="$NODE_HOME/bin:$PATH"; fi

need_node() {
  (( $(node_major) >= 20 )) && return 0
  echo "Node 20+ is required (found $(node --version 2>/dev/null || echo none)); install it or unpack it into $NODE_HOME" >&2
  exit 1
}
