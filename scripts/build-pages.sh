#!/usr/bin/env bash
# Assemble the GitHub Pages site into _site/:
#  - the HTML edition (html/) is served from the site root
#  - every html/<page>.html gets a redirect stub, so old /html/... links keep working
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="${1:-_site}"

rm -rf "$OUT"
mkdir -p "$OUT/html"
cp -r html/. "$OUT/"

for f in html/*.html; do
    name="$(basename "$f")"
    target="../$name"
    [ "$name" = "index.html" ] && target="../"
    cat > "$OUT/html/$name" <<STUB
<!DOCTYPE html>
<html lang="fi">
<head>
<meta charset="UTF-8">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=$target">
<link rel="canonical" href="$target">
<script>location.replace("$target" + location.hash);</script>
<title>Siirretty</title>
</head>
<body><p>Sivu on siirtynyt: <a href="$target">$target</a></p></body>
</html>
STUB
done

echo "Built $(find "$OUT" -name '*.html' | wc -l) HTML files into $OUT/"
