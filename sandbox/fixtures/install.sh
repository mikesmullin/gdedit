#!/usr/bin/env bash
DB_ARGS=()
if [[ -n "${1:-}" ]]; then DB_ARGS=(--db "$1"); fi
cd "$(dirname "$0")" || exit 1
for fixture in queue-schema.yaml queue-seed.yaml task-schema.yaml; do ontology "${DB_ARGS[@]}" import "$fixture" || exit 1; done
echo "Done. Fixtures imported."
