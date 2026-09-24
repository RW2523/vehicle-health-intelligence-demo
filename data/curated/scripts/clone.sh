#!/bin/bash
d=$1; r=$2; dest=raw/$d/${r/\//__}
mkdir -p raw/$d
if [ -d "$dest" ]; then echo "SKIP $r"; exit; fi
GIT_LFS_SKIP_SMUDGE=0 timeout 1500 git clone -q --depth 1 https://github.com/$r.git "$dest" && rm -rf "$dest/.git" && echo "OK $r $(du -sh $dest|cut -f1)" || echo "FAIL $r"
