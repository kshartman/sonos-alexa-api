#!/bin/bash
# Script to push to GitHub while filtering out private files

set -e

# Function to show usage
show_usage() {
    echo "push-to-github.sh - Push to GitHub while filtering out private files"
    echo ""
    echo "Usage: $0 [--action:dryrun|--action:execute]"
    echo "       $0 --help"
    echo ""
    echo "Options:"
    echo "  --action:dryrun    Prepare repository but don't push (default)"
    echo "  --action:execute   Actually push to GitHub"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "Description:"
    echo "  This script creates a filtered copy of the repository that excludes"
    echo "  private files listed in .github-exclude before pushing to GitHub."
    echo "  The script defaults to dry-run mode for safety."
    echo ""
    echo "  Files excluded by .github-exclude:"
    if [ -f ".github-exclude" ]; then
        echo "$(cat .github-exclude | grep -v '^#' | grep -v '^$' | sed 's/^/    - /')"
    else
        echo "    (no .github-exclude file found)"
    fi
    echo ""
    echo "Examples:"
    echo "  $0                    # Dry run (default)"
    echo "  $0 --action:dryrun    # Explicit dry run"
    echo "  $0 --action:execute   # Actually push to GitHub"
    echo ""
    echo "Safety:"
    echo "  - Defaults to dry-run mode"
    echo "  - Creates a temporary filtered repository"
    echo "  - Your local repository remains unchanged"
    echo "  - Private files are only excluded from the GitHub push"
}

# Check for help flag
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    show_usage
    exit 0
fi

# Parse command line arguments
ACTION="dryrun"
for arg in "$@"; do
    case $arg in
        --action:dryrun)
            ACTION="dryrun"
            shift
            ;;
        --action:execute)
            ACTION="execute"
            shift
            ;;
        *)
            echo "Unknown argument: $arg"
            echo ""
            show_usage
            exit 1
            ;;
    esac
done

echo "🚀 Preparing to push to GitHub (mode: $ACTION)..."

# Save original directory
ORIG_DIR=$(pwd)

# Check if upstream remote exists
if ! git remote | grep -q "^upstream$"; then
    echo "❌ Upstream remote not found. Add it with:"
    echo "   git remote add upstream git@github.com:kshartman/sonos-alexa-api.git"
    exit 1
fi

# Files to filter out (uses .github-exclude)
EXCLUDE_FILE=".github-exclude"

# Get the latest version tag
VERSION=$(git describe --tags --abbrev=0 2>/dev/null || echo "v1.0.0")

# Create a temporary directory for the filtered repo
TEMP_DIR="temp/$VERSION"

# If executing, clean up any existing temp directory first
if [ "$ACTION" = "execute" ] && [ -d "$TEMP_DIR" ]; then
    echo "🗑️  Cleaning up existing temp directory from previous dry run..."
    rm -rf "$TEMP_DIR"
fi

mkdir -p "$TEMP_DIR"
echo "📁 Using temp directory: $TEMP_DIR"

# Clone the current repo to temp directory
git clone --no-hardlinks . "$TEMP_DIR/filtered"
cd "$TEMP_DIR/filtered"

# Remove the origin remote to avoid confusion
git remote remove origin

# Add GitHub as origin
git remote add origin git@github.com:kshartman/sonos-alexa-api.git

# Remove files listed in .github-exclude
if [ -f "$EXCLUDE_FILE" ]; then
    echo "🗑️  Removing private files..."
    while IFS= read -r pattern || [ -n "$pattern" ]; do
        # Skip comments and empty lines
        [[ "$pattern" =~ ^#.*$ ]] && continue
        [[ -z "$pattern" ]] && continue
        
        # Remove the files/patterns
        git rm -r --cached "$pattern" 2>/dev/null || true
    done < "$ORIG_DIR/$EXCLUDE_FILE"
    
    # Also remove the exclude file itself
    git rm --cached "$EXCLUDE_FILE" 2>/dev/null || true
    
    # Commit the removals
    git commit -m "Remove private files for public release" || true
fi

# Clean up all untracked files to avoid confusion
echo "🧹 Cleaning up untracked files..."
git clean -fdx

# Push to GitHub or show dry run results
if [ "$ACTION" = "execute" ]; then
    echo "📤 Pushing to GitHub..."
    # Get current branch name
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    git push origin $CURRENT_BRANCH --force
    git push origin --tags
    
    # Clean up
    cd - > /dev/null
    rm -rf "$TEMP_DIR"
    
    echo "✅ Successfully pushed to GitHub with private files excluded!"
    echo ""
    echo "Note: Your local repository still contains all files."
    echo "The private files were only excluded from the GitHub push."
else
    # Dry run - keep the directory for inspection
    echo ""
    echo "🔍 DRY RUN COMPLETE - Repository prepared but NOT pushed"
    echo ""
    echo "📁 Inspect the prepared repository at:"
    echo "   $TEMP_DIR/filtered"
    echo ""
    echo "📋 To see what would be pushed:"
    echo "   cd $TEMP_DIR/filtered"
    echo "   git log --oneline -5"
    echo "   git ls-files | head -20  # List tracked files (what will be pushed)"
    echo "   git ls-files | wc -l     # Count of tracked files"
    echo ""
    echo "📊 Quick summary of what WILL be pushed:"
    cd "$ORIG_DIR/$TEMP_DIR/filtered"
    echo "   Total files: $(git ls-files | wc -l)"
    echo "   Excluded files verified removed:"
    for pattern in CLAUDE.md .claude/ docker-build.sh docker-run.sh push-to-github.sh docker-compose.yml .github-exclude; do
        # For files (not directories), check exact path from root
        if [[ "$pattern" == *"/"* ]] || [[ "$pattern" == *"/" ]]; then
            # Directory or path with slash - use original check
            if git ls-files | grep -q "$pattern"; then
                echo "   ❌ $pattern - STILL IN REPO!"
            else
                echo "   ✅ $pattern - successfully excluded"
            fi
        else
            # File without path - check only in root
            if git ls-files | grep -q "^${pattern}$"; then
                echo "   ❌ $pattern - STILL IN REPO!"
            else
                echo "   ✅ $pattern - successfully excluded"
            fi
        fi
    done
    cd - > /dev/null
    echo ""
    echo "🚀 To execute the actual push, run:"
    echo "   $0 --action:execute"
    echo ""
    echo "🗑️  To clean up the temp directory:"
    echo "   rm -rf $TEMP_DIR"
    echo ""
    echo "💡 To work in the filtered directory, run:"
    echo "   cd $TEMP_DIR/filtered"
fi