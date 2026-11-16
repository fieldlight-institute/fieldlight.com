#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_file="$repo_root/sitemap.xml"
temporary_file="$(mktemp)"
lastmod_date="${SITEMAP_LASTMOD:-$(date +%F)}"

cleanup() {
  rm -f "$temporary_file"
}
trap cleanup EXIT

cd "$repo_root"

{
  printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>'
  printf '%s\n' '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'

  while IFS= read -r page; do
    if [[ "$page" == "index.html" ]]; then
      url="https://fieldlight.com/"
    else
      url="https://fieldlight.com/${page%index.html}"
    fi

    printf '  <url><loc>%s</loc><lastmod>%s</lastmod></url>\n' "$url" "$lastmod_date"
  done < <(rg --files -g '*.html' -g '!google*.html' -g '!post/**' -g '!stream/templates/**' -g '!scripts/**' -g '!tests/**' -g '!docs/**' -g '!scripts/**' -g '!tests/**' -g '!docs/**' | sort)

  printf '%s\n' '</urlset>'
} > "$temporary_file"

mv "$temporary_file" "$output_file"
trap - EXIT
