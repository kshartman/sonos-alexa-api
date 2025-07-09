#!/bin/bash

#export SONOS_IP=<a coordinatorip> or specifiy on command line
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP_DIR="$(cd "${SCRIPT_DIR}/../temp" && pwd)"
node "${SCRIPT_DIR}/sonos-dump-all.cjs" > "${TEMP_DIR}/sonosdump.txt"
echo ${TEMP_DIR}/sonosdump.txt
