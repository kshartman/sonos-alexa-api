#!/bin/bash

# Script to tag the current commit with the version from package.json and push it
# Usage: ./tag-version.sh

# Get current version from package.json
version=$(npm run version:simple --silent 2>/dev/null)

if [ -z "$version" ]; then
    echo "Error: Could not read version from package.json"
    exit 1
fi

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "Error: Not in a git repository"
    exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo "Error: You have uncommitted changes. Please commit or stash them first."
    exit 1
fi

# Create the tag
tag="v${version}"

echo "Creating tag: $tag"

# Check if tag already exists
if git rev-parse "$tag" >/dev/null 2>&1; then
    echo "Error: Tag $tag already exists"
    echo "To delete the existing tag and create a new one, run:"
    echo "  git tag -d $tag"
    echo "  git push origin :refs/tags/$tag"
    exit 1
fi

# Create annotated tag
git tag -a "$tag" -m "Release version $version"

if [ $? -eq 0 ]; then
    echo "Tag $tag created successfully"
    
    # Push the tag
    echo "Pushing tag to origin..."
    git push origin "$tag"
    
    if [ $? -eq 0 ]; then
        echo "Tag $tag pushed successfully"
    else
        echo "Error: Failed to push tag"
        echo "You can try pushing manually with: git push origin $tag"
        exit 1
    fi
else
    echo "Error: Failed to create tag"
    exit 1
fi

echo ""
echo "Successfully tagged and pushed version $version"