#!/bin/bash

# Analyze authentication failures from container logs
# Usage: 
#   Interactive: ./analyze-auth-failures.sh [container-name]
#   Cron mode:   ./analyze-auth-failures.sh [container-name] --cron [--hourly N] [--eightly N] [--daily N]
#
# Default container name: sonos-api
# Default thresholds: hourly=5, eightly=10, daily=20

CONTAINER="${1:-sonos-api}"
shift || true

# Parse arguments
CRON_MODE=false
HOURLY_THRESHOLD=5
EIGHTLY_THRESHOLD=10
DAILY_THRESHOLD=20

while [[ $# -gt 0 ]]; do
    case $1 in
        --cron)
            CRON_MODE=true
            shift
            ;;
        --hourly)
            HOURLY_THRESHOLD="$2"
            shift 2
            ;;
        --eightly)
            EIGHTLY_THRESHOLD="$2"
            shift 2
            ;;
        --daily)
            DAILY_THRESHOLD="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check if container exists
if ! docker ps -a --format "{{.Names}}" | grep -q "^${CONTAINER}$"; then
    if [[ "$CRON_MODE" == "false" ]]; then
        echo "Error: Container '$CONTAINER' not found"
    fi
    exit 1
fi

# Function to count failures in time window
count_failures_in_window() {
    local hours="$1"
    local since_time
    
    case $hours in
        1) since_time="1 hour ago" ;;
        8) since_time="8 hours ago" ;;
        24) since_time="24 hours ago" ;;
    esac
    
    # Get logs once and count all patterns
    local logs=$(docker logs "$CONTAINER" --since "$since_time" 2>&1)
    local missing=$(echo "$logs" | grep -c "Missing authentication from" || echo 0)
    local invalid=$(echo "$logs" | grep -c "Invalid authorization header from" || echo 0)
    local failed=$(echo "$logs" | grep -c "Authentication failed for user" || echo 0)
    
    echo $((missing + invalid + failed))
}

# Get failure counts
failures_1h=$(count_failures_in_window 1)
failures_8h=$(count_failures_in_window 8)
failures_24h=$(count_failures_in_window 24)

# Cron mode - only output if thresholds exceeded
if [[ "$CRON_MODE" == "true" ]]; then
    threshold_exceeded=false
    warnings=""
    
    if [[ $failures_1h -gt $HOURLY_THRESHOLD ]]; then
        threshold_exceeded=true
        warnings+="WARNING: Auth failures in last hour: $failures_1h (threshold: $HOURLY_THRESHOLD)\n"
    fi
    
    if [[ $failures_8h -gt $EIGHTLY_THRESHOLD ]]; then
        threshold_exceeded=true
        warnings+="WARNING: Auth failures in last 8 hours: $failures_8h (threshold: $EIGHTLY_THRESHOLD)\n"
    fi
    
    if [[ $failures_24h -gt $DAILY_THRESHOLD ]]; then
        threshold_exceeded=true
        warnings+="WARNING: Auth failures in last 24 hours: $failures_24h (threshold: $DAILY_THRESHOLD)\n"
    fi
    
    if [[ "$threshold_exceeded" == "true" ]]; then
        echo -e "$warnings"
        echo "Top offending IPs (last 24 hours):"
        docker logs "$CONTAINER" --since "24 hours ago" 2>&1 | \
            grep -E "(Missing authentication|Invalid authorization header|Authentication failed)" | \
            grep -oE "from [0-9]+\.[0-9]+\.[0-9]+\.[0-9]+" | \
            sed 's/from //' | \
            sort | uniq -c | sort -rn | head -5 | \
            awk '{printf "  %d failures from %s\n", $1, $2}'
        
        # Exit with non-zero to indicate warning condition
        exit 2
    fi
    
    # Silent exit if no thresholds exceeded
    exit 0
fi

# Interactive mode - full report
echo "=== Authentication Failure Analysis ==="
echo "Container: $CONTAINER"
echo "Time: $(date)"
echo

# Get logs once for 24h window and analyze
LOGS_24H=$(docker logs "$CONTAINER" --since "24 hours ago" 2>&1)

# Count different types of failures
echo "=== Failure Counts by Time Window ==="
echo
echo "Type                    1 hour    8 hours   24 hours"
echo "----------------------------------------------------"

# Get logs for each time window
LOGS_1H=$(docker logs "$CONTAINER" --since "1 hour ago" 2>&1)
LOGS_8H=$(docker logs "$CONTAINER" --since "8 hours ago" 2>&1)

# Missing authentication
missing_1h=$(echo "$LOGS_1H" | grep -c "Missing authentication from" || echo 0)
missing_8h=$(echo "$LOGS_8H" | grep -c "Missing authentication from" || echo 0)
missing_24h=$(echo "$LOGS_24H" | grep -c "Missing authentication from" || echo 0)
printf "%-23s %6d    %7d   %8d\n" "Missing Auth" "$missing_1h" "$missing_8h" "$missing_24h"

# Invalid headers
invalid_1h=$(echo "$LOGS_1H" | grep -c "Invalid authorization header from" || echo 0)
invalid_8h=$(echo "$LOGS_8H" | grep -c "Invalid authorization header from" || echo 0)
invalid_24h=$(echo "$LOGS_24H" | grep -c "Invalid authorization header from" || echo 0)
printf "%-23s %6d    %7d   %8d\n" "Invalid Header" "$invalid_1h" "$invalid_8h" "$invalid_24h"

# Failed credentials
failed_1h=$(echo "$LOGS_1H" | grep -c "Authentication failed for user" || echo 0)
failed_8h=$(echo "$LOGS_8H" | grep -c "Authentication failed for user" || echo 0)
failed_24h=$(echo "$LOGS_24H" | grep -c "Authentication failed for user" || echo 0)
printf "%-23s %6d    %7d   %8d\n" "Bad Credentials" "$failed_1h" "$failed_8h" "$failed_24h"

# Totals
echo "----------------------------------------------------"
printf "%-23s %6d    %7d   %8d\n" "TOTAL" "$failures_1h" "$failures_8h" "$failures_24h"

echo
echo "=== Top Offending IPs (last 24 hours) ==="
echo
echo "$LOGS_24H" | \
    grep -E "(Missing authentication|Invalid authorization header|Authentication failed)" | \
    grep -oE "from [0-9]+\.[0-9]+\.[0-9]+\.[0-9]+" | \
    sed 's/from //' | \
    sort | uniq -c | sort -rn | head -10 | \
    awk '{printf "%5d failures from %s\n", $1, $2}'

echo
echo "=== Failed Username Attempts (last 24 hours) ==="
echo
echo "$LOGS_24H" | \
    grep "Authentication failed for user" | \
    grep -oE "user '[^']+'" | \
    sed "s/user '//" | sed "s/'//" | \
    sort | uniq -c | sort -rn | head -10 | \
    awk '{printf "%5d attempts as %s\n", $1, $2}'

echo
echo "=== Recent Failures (last 10) ==="
echo
echo "$LOGS_24H" | \
    grep -E "(Missing authentication|Invalid authorization header|Authentication failed)" | \
    tail -10