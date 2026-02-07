#!/bin/bash
# Commit files with their modification dates as commit timestamps
# Usage: ./git-dated-commit.sh "file1 file2" "commit message" "reference_file_for_date"

commit_dated() {
    local files="$1"
    local msg="$2"
    local ref_file="$3"

    local mtime=$(stat --format='%Y' "$ref_file" 2>/dev/null)
    if [ -z "$mtime" ]; then
        echo "Error: Cannot stat $ref_file"
        return 1
    fi

    local date_str=$(date -d "@$mtime" --iso-8601=seconds)
    local human_date=$(date -d "@$mtime" "+%Y-%m-%d %H:%M:%S")

    git add $files
    GIT_AUTHOR_DATE="$date_str" GIT_COMMITTER_DATE="$date_str" \
        git commit -m "$msg

Originally created: $human_date" && echo "✓ $msg @ $human_date"
}

# If called with args, run directly
if [ $# -ge 3 ]; then
    commit_dated "$1" "$2" "$3"
fi
