#!/usr/bin/env bash
# setup-local.sh [--dryrun] [settings-name]
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
# Options:
#   --dryrun    Show what would be done without making changes
#
# This assumes you have ../private/settings-{HOSTNAME}.json and ../presets/presets-${HOSTNAME}/
#
# Parse command line arguments
DRY_RUN=false
ARGS=()

for arg in "$@"; do
    case $arg in
        --dryrun)
            DRY_RUN=true
            ;;
        *)
            ARGS+=("$arg")
            ;;
    esac
done

if (( ${#ARGS[@]} >= 1 )); then
   BUILDFOR=${ARGS[0]}
else
    BUILDFOR=$(echo "${HOSTNAME%%.*}" | tr '[:upper:]' '[:lower:]')
fi    

if [ "$DRY_RUN" = true ]; then
    echo "*** DRY RUN MODE - No changes will be made ***"
    echo ""
fi

echo Copying files to build ${BUILDFOR}...

# Remove settings.json if it exists (using env vars instead)
if [ -f settings.json ]; then
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY RUN] Would remove settings.json (using environment variables instead)"
    else
        echo "Removing settings.json (using environment variables instead)"
        rm -f settings.json
    fi
fi

# Clean up any settings symlinks
if [ "$DRY_RUN" = true ]; then
    if ls settings-${BUILDFOR}.json 2>/dev/null >/dev/null; then
        echo "[DRY RUN] Would remove settings-${BUILDFOR}.json"
    fi
else
    rm -f settings-${BUILDFOR}.json 2>/dev/null || true
fi

if [ -f ../private/.env-${BUILDFOR} ]; then
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY RUN] Would copy ../private/.env-${BUILDFOR} to .env"
        echo "[DRY RUN] Would create symlink .env-${BUILDFOR} -> ../private/.env-${BUILDFOR}"
    else
        echo cp ../private/.env-${BUILDFOR} .env
        rm -f .env
        cp ../private/.env-${BUILDFOR} .env
        rm -f .env-${BUILDFOR}
        ln -s ../private/.env-${BUILDFOR} .
    fi
else
    echo error: no such .env ../private/.env-${BUILDFOR}
    if [ "$DRY_RUN" != true ]; then
        exit 1
    fi
fi

if [ -d ../presets/presets-${BUILDFOR} ]; then
    if [ "$DRY_RUN" = true ]; then
        # Dry run mode
        if [ -L ./presets ] || [ -d ./presets ] || [ -f ./presets ]; then
            echo "[DRY RUN] Would remove existing ./presets"
        fi
        echo "[DRY RUN] Would copy ../presets/presets-${BUILDFOR} -> ./presets"
    else
        if [ -L ./presets ]; then
            rm ./presets 
        elif [ -d ./presets ]; then
            rm -rf ./presets
        elif [ -f ./presets ]; then
            rm ./presets
        fi
        mkdir ./presets
        echo  "cp ../presets/presets-${BUILDFOR} -> ./presets"
        (cd ../presets/presets-${BUILDFOR} && tar cf - .) | (cd ./presets && tar xf -)
    fi
 else
    echo error: no such presets ../presets/presets-${BUILDFOR}/
    if [ "$DRY_RUN" != true ]; then
        exit 1
    fi
fi

# Update test/.env with DEFAULT_ROOM from main .env
if [ -f .env ] && [ -f test/.env ]; then
    # Extract DEFAULT_ROOM from main .env
    DEFAULT_ROOM=$(grep "^DEFAULT_ROOM=" .env | cut -d'=' -f2)
    
    if [ -n "$DEFAULT_ROOM" ]; then
        if [ "$DRY_RUN" = true ]; then
            if grep -q "^TEST_ROOM=" test/.env; then
                echo "[DRY RUN] Would update TEST_ROOM in test/.env to ${DEFAULT_ROOM}"
            else
                echo "[DRY RUN] Would add TEST_ROOM=${DEFAULT_ROOM} to test/.env"
            fi
        else
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
        fi
    else
        if [ "$DRY_RUN" != true ]; then
            echo "No DEFAULT_ROOM found in .env, leaving test/.env unchanged"
        fi
    fi
else
    if [ "$DRY_RUN" != true ]; then
        echo "Skipping test/.env update (missing .env or test/.env)"
    fi
fi
