#!/bin/bash

# Script to update version in package.json
# Usage: ./set-version.sh [--major VERSION|+N] [--minor VERSION|+N] [--patch VERSION|+N]

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