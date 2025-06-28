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

echo Copying files to build ${BUILDFOR}...

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

# Update test/.env with DEFAULT_ROOM from main .env
if [ -f .env ] && [ -f test/.env ]; then
    # Extract DEFAULT_ROOM from main .env
    DEFAULT_ROOM=$(grep "^DEFAULT_ROOM=" .env | cut -d'=' -f2)
    
    if [ -n "$DEFAULT_ROOM" ]; then
        echo "Updating test/.env with TEST_ROOM=${DEFAULT_ROOM}"
        
        # Update or add TEST_ROOM in test/.env
        if grep -q "^TEST_ROOM=" test/.env; then
            # Update existing TEST_ROOM line
            sed -i.bak "s/^TEST_ROOM=.*/TEST_ROOM=${DEFAULT_ROOM}/" test/.env
            rm test/.env.bak
        else
            # Add TEST_ROOM line
            echo "TEST_ROOM=${DEFAULT_ROOM}" >> test/.env
        fi
    else
        echo "No DEFAULT_ROOM found in .env, leaving test/.env unchanged"
    fi
else
    echo "Skipping test/.env update (missing .env or test/.env)"
fi
