#!/usr/bin/env bash
# setup-local.sh [settings-name]
#
# The purpose of this script is to copy the appropriate presets and
# settings for this host into the project directory.  These are the
# presets and settings that will be present in the final
# container. Since I have two homes, there is a host in each home that
# runs the alexa skill support.  Each home has a different sonos
# system with some shared presets but many are unique, particularly
# the room parameters.  It also copies in the correct settings.json
# for the host. If no argument, it defaults to current hostname,
# domain stripped, lowercase.
#
# This assumes you have ../private/settings-{HOSTNAME}.json and ../presets/presets-${HOSTNAME}/
#
if (( $# >= 1 )); then
   BUILDFOR=$1
else
    BUILDFOR=$(echo "${HOSTNAME%%.*}" | tr '[:upper:]' '[:lower:]')
fi    

if [ -f ../private/settings-${BUILDFOR}.json ]; then
    rm settings.json
    cp ../private/settings-${BUILDFOR}.json settings.json
    rm settings-${BUILDFOR}.json
    ln -s ../private/settings-${BUILDFOR}.json .
else
    echo error: no such settings ../private/settings-${BUILDFOR}.json
    exit 1
fi

if [ -f ../private/.env-${BUILDFOR} ]; then
    rm .env
    cp ../private/.env-${BUILDFOR} .env
    rm .env-${BUILDFOR}
    ln -s ../private/.env-${BUILDFOR} .
else
    echo error: no such .env ../private/.env-${BUILDFOR}
    exit 1
fi

if [ -d ../presets/presets-${BUILDFOR} ]; then
    if [ -L ./presets ]; then
        rm ./presets 
    elif [ -d ./presets ]; then
        rm -rf ./presets
    elif [ -f ./presets ]; then
        rm ./presets
    fi
    mkdir ./presets
    (cd ../presets/presets-${BUILDFOR} && tar cf - .) | (cd ./presets && tar xf -)
 else
    echo error: no such presets ../presets/presets-${BUILDFOR}/
    exit 1
fi
