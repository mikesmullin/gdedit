#!/usr/bin/env bash
DB_ARGS=()
if [[ -n "${1:-}" ]]; then DB_ARGS=(--db "$1"); fi
for fixture in queue-schema.yaml queue-seed.yaml task-schema.yaml; do ontology "${DB_ARGS[@]}" import "$fixture"; done
echo "Done. Fixtures imported."
