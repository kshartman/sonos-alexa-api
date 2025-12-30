#!/bin/bash
#
# validate-presets.sh - Validate preset files between docker mount and private repo
#
# This script validates:
# 1. Symlinks in docker mount point to existing files
# 2. Non-symlink presets reference valid favorite URIs in Sonos
# 3. Symlinks in private preset repo point to existing files
# 4. Non-symlinks in private repo exist in docker mount with identical content
# 5. Symlinks in private repo exist in docker mount
# 6. Files that exist only in one location or the other
#

set -euo pipefail

# Determine instance from hostname (short name only)
INSTANCE=$(hostname -s)
API_PORT=${API_PORT:-35005}
API_URL="http://localhost:${API_PORT}"

# Paths - use consistent base path
BASE_HOME="/home/shartman"
DOCKER_MOUNT="${BASE_HOME}/projects/sonos/api/presets"
PRIVATE_REPO="${BASE_HOME}/projects/sonos/presets/presets-${INSTANCE}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
ERRORS=0
WARNINGS=0

# Arrays for tracking issues
declare -a DOCKER_BROKEN_SYMLINKS=()
declare -a DOCKER_INVALID_FAVORITES=()
declare -a PRIVATE_BROKEN_SYMLINKS=()
declare -a CONTENT_MISMATCHES=()
declare -a ONLY_IN_DOCKER=()
declare -a ONLY_IN_PRIVATE=()
declare -a MISSING_SYMLINKS=()

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_ok() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
    WARNINGS=$((WARNINGS + 1))
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    ERRORS=$((ERRORS + 1))
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if [[ ! -d "$DOCKER_MOUNT" ]]; then
        log_error "Docker mount directory not found: $DOCKER_MOUNT"
        exit 1
    fi

    if [[ ! -d "$PRIVATE_REPO" ]]; then
        log_error "Private repo directory not found: $PRIVATE_REPO"
        log_info "Expected path for instance '$INSTANCE': $PRIVATE_REPO"
        exit 1
    fi

    # Check if API is running
    if ! curl -s "${API_URL}/health" > /dev/null 2>&1; then
        log_warn "Sonos API not responding at ${API_URL} - favorite validation will be skipped"
        API_AVAILABLE=false
    else
        API_AVAILABLE=true
        log_ok "Sonos API available at ${API_URL}"
    fi

    log_ok "Docker mount: $DOCKER_MOUNT"
    log_ok "Private repo: $PRIVATE_REPO"
}

# Fetch favorites from API
declare -A FAVORITE_URIS=()
fetch_favorites() {
    if [[ "$API_AVAILABLE" != "true" ]]; then
        return
    fi

    log_info "Fetching favorites from Sonos API..."

    # First get zones to find a valid room
    local zones_json
    zones_json=$(curl -s "${API_URL}/zones" 2>/dev/null || echo "")

    local room=""
    if [[ -n "$zones_json" && "$zones_json" != "null" ]]; then
        room=$(echo "$zones_json" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, list) and len(data) > 0:
        # Coordinator can be a string (room name) or an object
        coord = data[0].get('coordinator', '')
        if isinstance(coord, str):
            print(coord)
        elif isinstance(coord, dict):
            print(coord.get('roomName', ''))
except:
    pass
" 2>/dev/null)
    fi

    if [[ -z "$room" ]]; then
        log_warn "Could not determine a room for favorites query"
        return
    fi

    # URL encode room name
    local encoded_room
    encoded_room=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$room'))")

    local favorites_json
    favorites_json=$(curl -s "${API_URL}/${encoded_room}/favorites" 2>/dev/null || echo "")

    if [[ -z "$favorites_json" || "$favorites_json" == "null" || "$favorites_json" == *'"error"'* ]]; then
        log_warn "Could not fetch favorites from API"
        return
    fi

    # Extract favorite names - API returns list of strings or list of objects
    while IFS= read -r name; do
        if [[ -n "$name" ]]; then
            # Store lowercase version for matching
            local lower_name
            lower_name=$(echo "$name" | tr '[:upper:]' '[:lower:]')
            FAVORITE_URIS["$lower_name"]=1
        fi
    done < <(echo "$favorites_json" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        for item in data:
            if isinstance(item, str):
                print(item)
            elif isinstance(item, dict):
                print(item.get('title', item.get('name', '')))
except:
    pass
" 2>/dev/null)

    local count=${#FAVORITE_URIS[@]}
    log_ok "Loaded $count favorites from Sonos (room: $room)"
}

# Check if a preset's favorite exists in Sonos
check_preset_favorite() {
    local preset_file="$1"

    if [[ "$API_AVAILABLE" != "true" ]]; then
        return 0
    fi

    # Extract favorite name from preset JSON
    local favorite
    favorite=$(python3 -c "
import sys, json
try:
    with open('$preset_file') as f:
        data = json.load(f)
    fav = data.get('favorite', data.get('uri', ''))
    print(fav)
except:
    pass
" 2>/dev/null)

    if [[ -z "$favorite" ]]; then
        # No favorite field - might be a different type of preset
        return 0
    fi

    # Check if favorite exists (case-insensitive)
    local lower_favorite
    lower_favorite=$(echo "$favorite" | tr '[:upper:]' '[:lower:]')

    # Check if favorite exists in our loaded favorites (case-insensitive)
    if [[ ${#FAVORITE_URIS[@]} -eq 0 ]]; then
        # No favorites loaded, skip validation
        return 0
    fi

    local found=false
    for key in "${!FAVORITE_URIS[@]}"; do
        if [[ "$key" == "$lower_favorite" ]]; then
            found=true
            break
        fi
    done

    if [[ "$found" == "false" ]]; then
        return 1
    fi

    return 0
}

# Validate symlinks in a directory
validate_symlinks() {
    local dir="$1"
    local label="$2"
    local -n broken_array="$3"

    log_info "Validating symlinks in $label..."

    local count=0
    local broken=0

    while IFS= read -r -d '' link; do
        count=$((count + 1))
        local target
        target=$(readlink "$link")
        local full_target

        # Handle relative symlinks
        if [[ "$target" != /* ]]; then
            full_target="$(dirname "$link")/$target"
        else
            full_target="$target"
        fi

        if [[ ! -e "$full_target" ]]; then
            broken_array+=("$(basename "$link") -> $target")
            broken=$((broken + 1))
        fi
    done < <(find "$dir" -maxdepth 1 -type l -print0 2>/dev/null)

    if [[ $broken -eq 0 ]]; then
        log_ok "$label: All $count symlinks valid"
    else
        log_error "$label: $broken/$count symlinks broken"
    fi
}

# Validate preset favorites
validate_favorites() {
    local dir="$1"
    local label="$2"
    local -n invalid_array="$3"

    if [[ "$API_AVAILABLE" != "true" ]]; then
        log_warn "Skipping favorite validation (API not available)"
        return
    fi

    log_info "Validating preset favorites in $label..."

    local count=0
    local invalid=0

    while IFS= read -r -d '' file; do
        count=$((count + 1))
        if ! check_preset_favorite "$file"; then
            local favorite
            favorite=$(python3 -c "
import json
with open('$file') as f:
    data = json.load(f)
print(data.get('favorite', data.get('uri', 'unknown')))
" 2>/dev/null)
            invalid_array+=("$(basename "$file"): $favorite")
            invalid=$((invalid + 1))
        fi
    done < <(find "$dir" -maxdepth 1 -type f -name "*.json" -print0 2>/dev/null)

    if [[ $invalid -eq 0 ]]; then
        log_ok "$label: All $count presets reference valid favorites"
    else
        log_warn "$label: $invalid/$count presets reference unknown favorites"
    fi
}

# Compare files between directories
compare_directories() {
    log_info "Comparing docker mount and private repo..."

    # Get lists of files
    local docker_files=()
    local private_files=()

    while IFS= read -r -d '' file; do
        docker_files+=("$(basename "$file")")
    done < <(find "$DOCKER_MOUNT" -maxdepth 1 -name "*.json" -print0 2>/dev/null)

    while IFS= read -r -d '' file; do
        private_files+=("$(basename "$file")")
    done < <(find "$PRIVATE_REPO" -maxdepth 1 -name "*.json" -print0 2>/dev/null)

    # Find files only in docker
    for file in "${docker_files[@]}"; do
        local found=false
        for pfile in "${private_files[@]}"; do
            if [[ "$file" == "$pfile" ]]; then
                found=true
                break
            fi
        done
        if [[ "$found" == "false" ]]; then
            ONLY_IN_DOCKER+=("$file")
        fi
    done

    # Find files only in private
    for file in "${private_files[@]}"; do
        local found=false
        for dfile in "${docker_files[@]}"; do
            if [[ "$file" == "$dfile" ]]; then
                found=true
                break
            fi
        done
        if [[ "$found" == "false" ]]; then
            ONLY_IN_PRIVATE+=("$file")
        fi
    done

    # Compare content of common files
    for file in "${docker_files[@]}"; do
        local docker_path="$DOCKER_MOUNT/$file"
        local private_path="$PRIVATE_REPO/$file"

        if [[ ! -e "$private_path" ]]; then
            continue
        fi

        # Check if both are symlinks
        if [[ -L "$docker_path" && -L "$private_path" ]]; then
            local docker_target private_target
            docker_target=$(readlink "$docker_path")
            private_target=$(readlink "$private_path")
            if [[ "$docker_target" != "$private_target" ]]; then
                CONTENT_MISMATCHES+=("$file: symlink targets differ (docker: $docker_target, private: $private_target)")
            fi
        # Check if one is symlink and other is not
        elif [[ -L "$docker_path" && ! -L "$private_path" ]]; then
            CONTENT_MISMATCHES+=("$file: docker is symlink, private is regular file")
        elif [[ ! -L "$docker_path" && -L "$private_path" ]]; then
            CONTENT_MISMATCHES+=("$file: docker is regular file, private is symlink")
        # Both are regular files - compare content
        elif [[ -f "$docker_path" && -f "$private_path" ]]; then
            if ! diff -q "$docker_path" "$private_path" > /dev/null 2>&1; then
                CONTENT_MISMATCHES+=("$file: content differs")
            fi
        fi
    done

    log_ok "Comparison complete"
}

# Print report
print_report() {
    echo ""
    echo "=============================================="
    echo "       PRESET VALIDATION REPORT"
    echo "=============================================="
    echo "Instance: $INSTANCE"
    echo "Docker mount: $DOCKER_MOUNT"
    echo "Private repo: $PRIVATE_REPO"
    echo "API URL: $API_URL (available: $API_AVAILABLE)"
    echo "=============================================="
    echo ""

    local has_issues=false

    # Broken symlinks in docker mount
    if [[ ${#DOCKER_BROKEN_SYMLINKS[@]} -gt 0 ]]; then
        has_issues=true
        echo -e "${RED}=== Broken Symlinks in Docker Mount ===${NC}"
        for item in "${DOCKER_BROKEN_SYMLINKS[@]}"; do
            echo "  - $item"
        done
        echo ""
    fi

    # Broken symlinks in private repo
    if [[ ${#PRIVATE_BROKEN_SYMLINKS[@]} -gt 0 ]]; then
        has_issues=true
        echo -e "${RED}=== Broken Symlinks in Private Repo ===${NC}"
        for item in "${PRIVATE_BROKEN_SYMLINKS[@]}"; do
            echo "  - $item"
        done
        echo ""
    fi

    # Invalid favorites
    if [[ ${#DOCKER_INVALID_FAVORITES[@]} -gt 0 ]]; then
        has_issues=true
        echo -e "${YELLOW}=== Presets with Unknown Favorites ===${NC}"
        for item in "${DOCKER_INVALID_FAVORITES[@]}"; do
            echo "  - $item"
        done
        echo ""
    fi

    # Content mismatches
    if [[ ${#CONTENT_MISMATCHES[@]} -gt 0 ]]; then
        has_issues=true
        echo -e "${YELLOW}=== Content Mismatches ===${NC}"
        for item in "${CONTENT_MISMATCHES[@]}"; do
            echo "  - $item"
        done
        echo ""
    fi

    # Files only in docker
    if [[ ${#ONLY_IN_DOCKER[@]} -gt 0 ]]; then
        has_issues=true
        echo -e "${BLUE}=== Files Only in Docker Mount ===${NC}"
        for item in "${ONLY_IN_DOCKER[@]}"; do
            echo "  - $item"
        done
        echo ""
    fi

    # Files only in private
    if [[ ${#ONLY_IN_PRIVATE[@]} -gt 0 ]]; then
        has_issues=true
        echo -e "${BLUE}=== Files Only in Private Repo ===${NC}"
        for item in "${ONLY_IN_PRIVATE[@]}"; do
            echo "  - $item"
        done
        echo ""
    fi

    # Summary
    echo "=============================================="
    echo "                 SUMMARY"
    echo "=============================================="
    echo "Broken symlinks (docker):  ${#DOCKER_BROKEN_SYMLINKS[@]}"
    echo "Broken symlinks (private): ${#PRIVATE_BROKEN_SYMLINKS[@]}"
    echo "Invalid favorites:         ${#DOCKER_INVALID_FAVORITES[@]}"
    echo "Content mismatches:        ${#CONTENT_MISMATCHES[@]}"
    echo "Only in docker:            ${#ONLY_IN_DOCKER[@]}"
    echo "Only in private:           ${#ONLY_IN_PRIVATE[@]}"
    echo ""

    if [[ "$has_issues" == "true" ]]; then
        echo -e "${YELLOW}Issues found. Review above for details.${NC}"
        return 1
    else
        echo -e "${GREEN}All validations passed. Directories are in sync.${NC}"
        return 0
    fi
}

# Main
main() {
    echo "Preset Validation Script"
    echo "========================"
    echo ""

    check_prerequisites
    echo ""

    fetch_favorites
    echo ""

    # Validate symlinks
    validate_symlinks "$DOCKER_MOUNT" "Docker mount" DOCKER_BROKEN_SYMLINKS
    validate_symlinks "$PRIVATE_REPO" "Private repo" PRIVATE_BROKEN_SYMLINKS
    echo ""

    # Validate favorites (only in docker mount since that's what's active)
    validate_favorites "$DOCKER_MOUNT" "Docker mount" DOCKER_INVALID_FAVORITES
    echo ""

    # Compare directories
    compare_directories
    echo ""

    # Print report
    print_report
}

main "$@"
