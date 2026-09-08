#!/usr/bin/env python3
import json
import re
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "continuity/data.json").read_text())

errors = []
publications = DATA["publications"]
threads = DATA["threads"]
publication_ids = {item["id"] for item in publications}
thread_ids = {item["id"] for item in threads}
stage_ids = {item["id"] for item in DATA.get("mapStages", [])}


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        attribute = "href" if tag in {"a", "link"} else "src" if tag in {"script", "img"} else None
        if attribute and values.get(attribute):
            self.references.append(values[attribute])


def local_target(page, reference):
    parsed = urlparse(reference)
    if parsed.scheme or parsed.netloc or reference.startswith(("mailto:", "#")):
        return None
    path = parsed.path
    target = ROOT / path.lstrip("/") if path.startswith("/") else page.parent / path
    if path.endswith("/"):
        target = target / "index.html"
    return target.resolve()

continuity_html = (ROOT / "continuity/index.html").read_text()
for label, count in (("public reading surfaces", len(publications)),
                     ("connection claims", len(DATA.get("connections", [])))):
    match = re.search(r"<dt>(\d+)</dt><dd>" + re.escape(label) + r"</dd>", continuity_html)
    if not match or int(match.group(1)) != count:
        errors.append(f"displayed {label} does not match data count {count}")
if len(publication_ids) != len(publications):
    errors.append("publication IDs are not unique")
if len({item["url"] for item in publications}) != len(publications):
    errors.append("publication URLs are not unique")

for item in publications:
    local = ROOT / item["url"].lstrip("/") / "index.html"
    if not local.exists():
        errors.append(f"missing reading surface for {item['id']}: {item['url']}")
    if item["primaryThread"] not in thread_ids:
        errors.append(f"unknown primary thread for {item['id']}")
    if not item.get("threads"):
        errors.append(f"no thread assignment for {item['id']}")
    for thread_id in item.get("threads", []):
        if thread_id not in thread_ids:
            errors.append(f"unknown thread {thread_id} on {item['id']}")
    if local.exists() and "reader-continuity.js" not in local.read_text():
        errors.append(f"continuity script missing from {item['id']}")

path_ids = set()
for thread in threads:
    for publication_id in thread["path"]:
        path_ids.add(publication_id)
        if publication_id not in publication_ids:
            errors.append(f"unknown publication {publication_id} in {thread['id']}")

missing_from_paths = publication_ids - path_ids
if missing_from_paths:
    errors.append("not present in any trajectory path: " + ", ".join(sorted(missing_from_paths)))

for context in DATA["contexts"]:
    if context.get("url") and urlparse(context["url"]).scheme != "https":
        errors.append(f"context URL is not HTTPS: {context['id']}")
    if not context.get("related"):
        errors.append(f"context has no public output: {context['id']}")
    for publication_id in context["related"]:
        if publication_id not in publication_ids:
            errors.append(f"unknown related publication {publication_id} on {context['id']}")

connection_ids = set()
for connection in DATA.get("connections", []):
    if connection["id"] in connection_ids:
        errors.append(f"duplicate connection ID: {connection['id']}")
    connection_ids.add(connection["id"])
    for endpoint in (connection["from"], connection["to"]):
        if endpoint not in publication_ids:
            errors.append(f"unknown endpoint {endpoint} on {connection['id']}")
    if connection.get("confidence") not in {"medium", "medium-high", "high"}:
        errors.append(f"invalid confidence on {connection['id']}")

if len(DATA.get("mapChains", [])) != 5:
    errors.append(f"expected 5 map chains, found {len(DATA.get('mapChains', []))}")
for chain in DATA.get("mapChains", []):
    cell_stages = {cell["stage"] for cell in chain["cells"]}
    if cell_stages != stage_ids:
        errors.append(f"map chain {chain['id']} does not cover all stages")
    for cell in chain["cells"]:
        for publication_id in cell["works"]:
            if publication_id not in publication_ids:
                errors.append(f"unknown map work {publication_id} in {chain['id']}")

for page in [ROOT / "continuity/index.html", ROOT / "writing/index.html", ROOT / "index.html",
             ROOT / "writing/at-two-heights/index.html", ROOT / "writing/found-language-atlas/index.html"]:
    parser = LinkParser()
    parser.feed(page.read_text())
    for reference in parser.references:
        target = local_target(page, reference)
        if target is not None and not target.exists():
            errors.append(f"broken local reference in {page.relative_to(ROOT)}: {reference}")

essay = (ROOT / "writing/at-two-heights/index.html").read_text()
continuous_text = re.sub(r"\s+", " ", re.sub(r"<[^>]*>", "", essay))
if re.search(r"<br\s*/?>(?!\s)", essay):
    errors.append("At Two Heights has a line break without a preserved word boundary")
if "The empty place already has a shape." not in continuous_text:
    errors.append("At Two Heights vacancy heading loses its word spacing")
if "noindex" in essay or "Private edition" in essay or "/Users/" in essay:
    errors.append("At Two Heights retains private draft metadata")
share_url = "https://fieldlight.com/writing/at-two-heights/assets/at-two-heights-share-2026-09-08.png"
if 'name="twitter:card" content="summary_large_image"' not in essay:
    errors.append("At Two Heights does not request a large X card")
for field in ('property="og:image"', 'name="twitter:image"'):
    if f'{field} content="{share_url}"' not in essay:
        errors.append(f"At Two Heights is missing {field} share metadata")
share_path = ROOT / "writing/at-two-heights/assets/at-two-heights-share-2026-09-08.png"
if not share_path.exists():
    errors.append("At Two Heights share image is missing")
elif share_path.stat().st_size >= 5 * 1024 * 1024:
    errors.append("At Two Heights share image exceeds the platform size limit")
atlas = (ROOT / "writing/found-language-atlas/index.html").read_text()
for entry in ("0023", "0024"):
    if f'id="entry-{entry}"' not in atlas or f'#entry-{entry}' not in essay:
        errors.append(f"missing reciprocal Atlas anchor for entry {entry}")
if atlas.count('../at-two-heights/#address-title') != 2:
    errors.append("Atlas must link both revisited encounters to At Two Heights")

if errors:
    for error in errors:
        print("ERROR:", error)
    raise SystemExit(1)

writing_html = (ROOT / "writing/index.html").read_text()
writing_count = len(re.findall(r'<li><a href="[^\"]+"><span>\d+</span><strong>', writing_html))
count_match = re.search(r'class="writing-index-count"><strong>(\d+)</strong>', writing_html)
if not count_match or int(count_match.group(1)) != writing_count:
    raise SystemExit(f"ERROR: Writing label does not match {writing_count} catalog entries")
home_html = (ROOT / "index.html").read_text()
for shown in re.findall(r"(\d+) authored pieces", home_html):
    if int(shown) != writing_count:
        raise SystemExit(f"ERROR: Homepage writing count {shown} does not match {writing_count}")

json_items = json.loads((ROOT / "feed.json").read_text())["items"]
rss_items = ET.parse(ROOT / "feed.xml").findall("./channel/item")
json_urls = [item["url"] for item in json_items]
rss_urls = [item.findtext("link") for item in rss_items]
if len(set(json_urls)) != len(json_urls) or len(set(rss_urls)) != len(rss_urls):
    raise SystemExit("ERROR: duplicate feed URLs")
if set(json_urls) != set(rss_urls):
    raise SystemExit("ERROR: JSON and RSS feeds list different works")
json_by_url = {item["url"]: item for item in json_items}
for item in rss_items:
    counterpart = json_by_url[item.findtext("link")]
    for json_key, xml_key in (("title", "title"), ("summary", "description")):
        if counterpart.get(json_key, "") != item.findtext(xml_key, ""):
            raise SystemExit(f"ERROR: feed {json_key} differs for {counterpart['url']}")

print(f"Catalog/feed checks valid: {writing_count} writing entries; {len(json_items)} matching feed items")

print(f"Reader Continuity valid: {len(publications)} publications, {len(DATA.get('mapChains', []))} evidence chains, {len(DATA.get('connections', []))} connections, {len(DATA['contexts'])} provenance records")
