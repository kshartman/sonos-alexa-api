#!/bin/bash

# Script to update version in package.json

# Check for help flag
if [ "$1" = "--help" ] || [ "$1" = "-h" ] || [ $# -eq 0 ]; then
    echo "set-version.sh - Update version in package.json and src/version.ts"
    echo ""
    echo "Usage: $0 [--major VERSION|+N] [--minor VERSION|+N] [--patch VERSION|+N]"
    echo "       $0 --help"
    echo ""
    echo "Options:"
    echo "  --major VERSION|+N   Set major version to VERSION or increment by N"
    echo "  --minor VERSION|+N   Set minor version to VERSION or increment by N"
    echo "  --patch VERSION|+N   Set patch version to VERSION or increment by N"
    echo "  -h, --help           Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --minor +1                  # Increment minor version (e.g., 1.5.0 → 1.6.0)"
    echo "  $0 --major 2                   # Set major version to 2 (e.g., 1.5.0 → 2.5.0)"
    echo "  $0 --patch +1                  # Increment patch version (e.g., 1.5.0 → 1.5.1)"
    echo "  $0 --major +1 --minor 0 --patch 0  # Major version bump (e.g., 1.5.3 → 2.0.0)"
    echo ""
    echo "Current version: $(node -p "require('./package.json').version")"
    echo ""
    echo "Description:"
    echo "  Updates the version number in package.json and automatically runs"
    echo "  'npm run version:save' to update src/version.ts. Version components"
    echo "  can be set to specific values or incremented by a given amount."
    exit 0
fi

# Read current version from package.json
current_version=$(node -p "require('./package.json').version")
IFS='.' read -r current_major current_minor current_patch <<< "$current_version"

# Initialize new version parts with current values
new_major=$current_major
new_minor=$current_minor
new_patch=$current_patch

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --major)
            shift
            if [[ $1 =~ ^\+([0-9]+)$ ]]; then
                # Increment by N
                increment=${BASH_REMATCH[1]}
                new_major=$((current_major + increment))
            elif [[ $1 =~ ^[0-9]+$ ]]; then
                # Set to specific value
                new_major=$1
            else
                echo "Error: Invalid major version value: $1"
                echo "Must be a non-negative integer or +N where N is positive"
                exit 1
            fi
            shift
            ;;
        --minor)
            shift
            if [[ $1 =~ ^\+([0-9]+)$ ]]; then
                # Increment by N
                increment=${BASH_REMATCH[1]}
                new_minor=$((current_minor + increment))
            elif [[ $1 =~ ^[0-9]+$ ]]; then
                # Set to specific value
                new_minor=$1
            else
                echo "Error: Invalid minor version value: $1"
                echo "Must be a non-negative integer or +N where N is positive"
                exit 1
            fi
            shift
            ;;
        --patch)
            shift
            if [[ $1 =~ ^\+([0-9]+)$ ]]; then
                # Increment by N
                increment=${BASH_REMATCH[1]}
                new_patch=$((current_patch + increment))
            elif [[ $1 =~ ^[0-9]+$ ]]; then
                # Set to specific value
                new_patch=$1
            else
                echo "Error: Invalid patch version value: $1"
                echo "Must be a non-negative integer or +N where N is positive"
                exit 1
            fi
            shift
            ;;
        *)
            echo "Error: Unknown option $1"
            echo "Usage: $0 [--major VERSION|+N] [--minor VERSION|+N] [--patch VERSION|+N]"
            exit 1
            ;;
    esac
done

# Construct new version
new_version="${new_major}.${new_minor}.${new_patch}"

# Update package.json
echo "Updating version from $current_version to $new_version"
node -e "
const pkg = require('./package.json');
pkg.version = '$new_version';
require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\\n');
"

# Run version:save to update version.ts
echo "Updating version.ts..."
npm run version:save

echo "Version updated successfully!"
echo "New version: $new_version"