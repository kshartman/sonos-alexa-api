#!/bin/bash

# Script to fix worf presets without losing any existing aliases
# This ensures compatibility with Alexa voice recognition

PRESET_DIR="../presets/presets-worf"
REPORT_FILE="worf-preset-fixes.md"

echo "# Worf Preset Fixes Report" > $REPORT_FILE
echo "Generated on: $(date)" >> $REPORT_FILE
echo "" >> $REPORT_FILE

cd "$PRESET_DIR" || exit 1

echo "## Current State" >> $REPORT_FILE
echo "Total files: $(ls -1 *.json 2>/dev/null | wc -l)" >> $REPORT_FILE
echo "Total symlinks: $(find . -type l | wc -l)" >> $REPORT_FILE
echo "" >> $REPORT_FILE

# From options.shane.js stdPresets array (lines 110-132)
STD_PRESETS=(
    "acoustic blues" "africa" "african night" "ambient music" "ambient radio"
    "ambient" "ambient dark" "an african night" "ancient beat"
    "ancient beats" "archaic beat" "archaic beats" "baroque music"
    "baroque radio" "baroque" "blues acoustic" "blues electric" "blues radio"
    "blues uk" "blues" "boot liquor" "chicago blues"
    "christmas music" "christmas radio" "christmas" "classic blues"
    "classic rock" "classical 101" "classical guitar" "classical music"
    "classical radio" "classical" "country" "crickets summer night"
    "dark ambient" "dark ambient radio" "electric blues"
    "electronic music" "electronic radio" "electronic" "frogs"
    "gangsta radio" "gangsta rap radio" "gangsta" "gangster radio"
    "gangster" "hard rock" "hearts of space" "jazz" "kera radio"
    "kera" "lounge" "middle eastern" "music for spys" "npr radio"
    "npr" "ocean sounds" "ocean surf" "ocean waves" "pbs" "public radio"
    "quiet classical" "quiet jazz" "quiet music" "rain"
    "reggae music" "reggae radio" "reggae" "rock music" "rock" "roots reggae"
    "sahara sunset radio" "sahara sunset" "secret agent" "shit kicker"
    "smooth jazz" "spy music" "summer crickets" "swamp rock"
    "this weeks show" "thunder storm" "thunder" "thundering rainstorm"
    "thunderstorm" "toad trills and thunder" "wrr" "thunder toads"
    "thunder tongues" "toads" "thunder tones"
)

echo "## Missing Presets from stdPresets" >> $REPORT_FILE
echo "These names from stdPresets don't exist as file or symlink:" >> $REPORT_FILE
echo "" >> $REPORT_FILE

MISSING_COUNT=0
for preset in "${STD_PRESETS[@]}"; do
    # Check if exists as .json file or symlink
    if [[ ! -f "$preset.json" && ! -L "$preset" && ! -L "$preset.json" ]]; then
        echo "- \"$preset\"" >> $REPORT_FILE
        ((MISSING_COUNT++))
    fi
done

if [[ $MISSING_COUNT -eq 0 ]]; then
    echo "*None - all stdPresets exist*" >> $REPORT_FILE
fi
echo "" >> $REPORT_FILE

# Fixes Section
echo "## Fixes to Apply" >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "### 1. Fix Typo" >> $REPORT_FILE
if [[ -L "ocean souunds" ]]; then
    echo "- Remove 'ocean souunds' (typo)" >> $REPORT_FILE
    echo "- Add 'ocean sounds' -> ocean_sounds.json" >> $REPORT_FILE
    
    # Apply fix
    rm "ocean souunds"
    ln -s ocean_sounds.json "ocean sounds"
    echo "  ✓ Fixed ocean sounds typo" >> $REPORT_FILE
else
    echo "- Typo already fixed or doesn't exist" >> $REPORT_FILE
fi
echo "" >> $REPORT_FILE

echo "### 2. Add Missing Aliases from stdPresetAliases" >> $REPORT_FILE
echo "Based on stdPresetAliases, these canonical names should have these aliases:" >> $REPORT_FILE
echo "" >> $REPORT_FILE

# Define mappings from stdPresetAliases (maintaining exact spellings including "boot licker")
declare -A PRESET_ALIASES
PRESET_ALIASES["ambient_radio"]="ambient radio|ambient|ambient music"
PRESET_ALIASES["an_african_night"]="an african night|africa|african night"
PRESET_ALIASES["archaic_beats"]="archaic beats|archaic beat|ancient beat|ancient beats"
PRESET_ALIASES["blues_acoustic"]="acoustic blues|blues acoustic"
PRESET_ALIASES["blues_chicago"]="chicago blues|classic blues|blues chicago"
PRESET_ALIASES["blues_electric"]="electric blues|blues electric"
PRESET_ALIASES["blues_radio"]="blues|blues radio|blues music"
PRESET_ALIASES["blues_uk_radio"]="blues uk|blues uk radio"
PRESET_ALIASES["boot_liquor"]="boot liquor|shit kicker music|boot liquor radio|country music|country|shit kicker|boot licker"
PRESET_ALIASES["classical_baroque"]="baroque|baroque classical|classical baroque|baroque music"
PRESET_ALIASES["classical_guitar"]="classical guitar|classical guitar music"
PRESET_ALIASES["classical_quiet"]="classical quiet|quiet classical music|quiet classical"
PRESET_ALIASES["classical_radio"]="classical radio|classical|classical 101|classical music|wrr"
PRESET_ALIASES["crickets_summer_night"]="crickets summer night|crickets|summer crickets"
PRESET_ALIASES["dark_ambient_radio"]="dark ambient|dark ambient radio"
PRESET_ALIASES["electronic_radio"]="electronic radio|electronic|electronic music"
PRESET_ALIASES["gangsta_rap_radio"]="gangsta rap|gangster radio|gangsta radio|gangsta|gangster|gangsta rap radio"
PRESET_ALIASES["hearts_of_space"]="hearts of space|hos"
PRESET_ALIASES["jazz_radio"]="jazz radio|jazz music|jazz"
PRESET_ALIASES["jazz_smooth"]="smooth jazz|quiet jazz|jazz smooth"
PRESET_ALIASES["kera"]="kera|public radio|kera radio|npr|npr radio|pbs"
PRESET_ALIASES["middle_eastern"]="middle eastern|middle eastern music"
PRESET_ALIASES["ocean_sounds"]="ocean sounds|ocean surf"
PRESET_ALIASES["ocean_waves"]="ocean waves"
PRESET_ALIASES["reggae_music"]="reggae music"
PRESET_ALIASES["reggae_radio"]="reggae radio|reggae"
PRESET_ALIASES["reggae_roots"]="roots reggae|reggae roots music|roots reggae music|reggae roots"
PRESET_ALIASES["rock_classic"]="classic rock|classic rock music"
PRESET_ALIASES["rock_radio"]="rock radio|rock|rock music"
PRESET_ALIASES["rock_swamp_radio"]="swamp rock|swamp rock radio|rock swamp|rock swamp radio"
PRESET_ALIASES["sahara_sunset_radio"]="sahara sunset|sahara sunset radio"
PRESET_ALIASES["secret_agent"]="secret agent|spy music radio|secret agent radio|spy music|music for spys"
PRESET_ALIASES["this_weeks_show"]="this weeks show|this week's show|this week show"
PRESET_ALIASES["thundering_rainstorm"]="thundering rainstorm|thunder storm|thunderstorm|rain|thunder"
PRESET_ALIASES["toad_trills_and_thunder"]="toad trills and thunder|thunder toads|thunder tongues|thunder tones|frogs|toads"

ADDED_COUNT=0
for canonical in "${!PRESET_ALIASES[@]}"; do
    if [[ -f "$canonical.json" ]]; then
        IFS='|' read -ra ALIASES <<< "${PRESET_ALIASES[$canonical]}"
        for alias in "${ALIASES[@]}"; do
            if [[ ! -L "$alias" && ! -L "$alias.json" && "$alias.json" != "$canonical.json" ]]; then
                echo "- Adding: '$alias' -> $canonical.json" >> $REPORT_FILE
                ln -s "$canonical.json" "$alias"
                ((ADDED_COUNT++))
            fi
        done
    fi
done

if [[ $ADDED_COUNT -eq 0 ]]; then
    echo "*No missing aliases to add*" >> $REPORT_FILE
else
    echo "" >> $REPORT_FILE
    echo "Added $ADDED_COUNT missing aliases" >> $REPORT_FILE
fi
echo "" >> $REPORT_FILE

echo "### 3. Missing Canonical Files" >> $REPORT_FILE
echo "These canonical preset names from stdPresetAliases don't have .json files:" >> $REPORT_FILE
echo "" >> $REPORT_FILE

MISSING_CANONICAL=0
for canonical in "${!PRESET_ALIASES[@]}"; do
    if [[ ! -f "$canonical.json" ]]; then
        echo "- $canonical.json" >> $REPORT_FILE
        ((MISSING_CANONICAL++))
    fi
done

if [[ $MISSING_CANONICAL -eq 0 ]]; then
    echo "*All canonical files exist*" >> $REPORT_FILE
fi
echo "" >> $REPORT_FILE

echo "### 4. Existing Aliases Not in stdPresetAliases" >> $REPORT_FILE
echo "These symlinks exist but aren't defined in stdPresetAliases:" >> $REPORT_FILE
echo "(These are kept to handle Alexa variations)" >> $REPORT_FILE
echo "" >> $REPORT_FILE

# Collect all defined aliases
DEFINED_ALIASES=()
for aliases in "${PRESET_ALIASES[@]}"; do
    IFS='|' read -ra ALIAS_ARRAY <<< "$aliases"
    DEFINED_ALIASES+=("${ALIAS_ARRAY[@]}")
done

# Find symlinks not in our defined list
EXTRA_COUNT=0
while IFS= read -r link; do
    link_name=$(basename "$link")
    link_name_no_ext="${link_name%.json}"
    
    found=0
    for defined in "${DEFINED_ALIASES[@]}"; do
        if [[ "$link_name_no_ext" == "$defined" ]]; then
            found=1
            break
        fi
    done
    
    if [[ $found -eq 0 ]]; then
        target=$(readlink "$link")
        echo "- '$link_name' -> $target" >> $REPORT_FILE
        ((EXTRA_COUNT++))
    fi
done < <(find . -type l -name "*")

if [[ $EXTRA_COUNT -eq 0 ]]; then
    echo "*No extra aliases found*" >> $REPORT_FILE
else
    echo "" >> $REPORT_FILE
    echo "Note: These $EXTRA_COUNT extra aliases are preserved for Alexa compatibility" >> $REPORT_FILE
fi
echo "" >> $REPORT_FILE

echo "### 5. Recommendations" >> $REPORT_FILE
echo "" >> $REPORT_FILE

# Check for special cases
echo "#### Special Cases to Review:" >> $REPORT_FILE
if [[ -L "lounge" ]]; then
    target=$(readlink "lounge")
    echo "- 'lounge' currently points to: $target" >> $REPORT_FILE
    echo "  Note: In talon, this points to sahara_sunset_radio.json" >> $REPORT_FILE
fi

if [[ -L "blues" ]]; then
    target=$(readlink "blues")
    echo "- 'blues' currently points to: $target" >> $REPORT_FILE
    echo "  Consider if this is the best default for just 'blues'" >> $REPORT_FILE
fi
echo "" >> $REPORT_FILE

echo "#### Missing from stdPresets but exist as files:" >> $REPORT_FILE
for json_file in *.json; do
    base_name="${json_file%.json}"
    base_name_spaces="${base_name//_/ }"
    
    found=0
    for preset in "${STD_PRESETS[@]}"; do
        if [[ "$preset" == "$base_name_spaces" ]]; then
            found=1
            break
        fi
    done
    
    if [[ $found -eq 0 && -f "$json_file" ]]; then
        echo "- $json_file (consider adding '$base_name_spaces' to stdPresets)" >> $REPORT_FILE
    fi
done
echo "" >> $REPORT_FILE

echo "## Summary" >> $REPORT_FILE
echo "- Fixed typo: ocean souunds -> ocean sounds" >> $REPORT_FILE
echo "- Added $ADDED_COUNT missing aliases from stdPresetAliases" >> $REPORT_FILE
echo "- Preserved $EXTRA_COUNT extra aliases for Alexa compatibility" >> $REPORT_FILE
echo "- Found $MISSING_CANONICAL missing canonical files" >> $REPORT_FILE
echo "- Found $MISSING_COUNT missing entries from stdPresets" >> $REPORT_FILE

echo ""
echo "Report saved to: $REPORT_FILE"
echo "All fixes have been applied. Review the report for recommendations."