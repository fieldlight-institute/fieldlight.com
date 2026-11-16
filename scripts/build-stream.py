#!/usr/bin/env python3
"""Render Fieldlight's public stream from existing publications and authorized post records."""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
from email.utils import format_datetime
from html import escape
from html.parser import HTMLParser
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
from urllib.parse import urljoin, urlsplit
import xml.etree.ElementTree as ET

SITE = Path(__file__).resolve().parents[1]
ORIGIN = 'https://fieldlight.com'
AUTHOR = {'name': 'Anni McHenry', 'url': ORIGIN + '/#anni-mchenry'}
POST_ID = re.compile(r'post-[1-9][0-9]*\Z')
ATOM = 'http://www.w3.org/2005/Atom'
CONTENT = 'http://purl.org/rss/1.0/modules/content/'
ET.register_namespace('atom', ATOM)
ET.register_namespace('content', CONTENT)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def date_value(value, *, strict=False):
    if not isinstance(value, str):
        raise ValueError('A publication date must be a string')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if strict and (parsed.tzinfo is None or 'T' not in value):
        raise ValueError('Post timestamps must include a time and timezone')
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def date_label(value):
    date = date_value(value)
    return f'{date.day} {date.strftime("%B %Y")}'


def safe_url(value):
    return isinstance(value, str) and urlsplit(value).scheme in {'https', 'http'} and bool(urlsplit(value).netloc)


class PageMetadata(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.links = []
        self.source = None
        self.jsonld = []
        self._json = None

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == 'meta':
            self.meta[attrs.get('property', attrs.get('name', ''))] = attrs.get('content', '')
        if tag == 'a' and attrs.get('href'):
            self.links.append(attrs['href'])
            if 'article-source-link' in attrs.get('class', '').split():
                self.source = attrs['href']
        if tag == 'script' and attrs.get('type') == 'application/ld+json':
            self._json = ''

    def handle_data(self, data):
        if self._json is not None:
            self._json += data

    def handle_endtag(self, tag):
        if tag == 'script' and self._json is not None:
            try:
                self.jsonld.append(json.loads(self._json))
            except json.JSONDecodeError:
                pass
            self._json = None


def metadata(path):
    page = PageMetadata()
    page.feed(path.read_text())
    return page


def schema_records(value):
    if isinstance(value, list):
        for item in value:
            yield from schema_records(item)
    elif isinstance(value, dict):
        yield value
        if '@graph' in value:
            yield from schema_records(value['@graph'])


def publication_catalog(site):
    """Baseline feeds are data, never generated input; catalog pages supply older works."""
    baseline = json.loads((site / 'stream/publications.json').read_text())
    items = {item['url']: deepcopy(item) for item in baseline['items']}
    catalog = json.loads((site / 'continuity/data.json').read_text())['publications']
    known = {ORIGIN + item['url']: item['title'] for item in catalog}
    writing = metadata(site / 'writing/index.html')
    for link in writing.links:
        url = urljoin(ORIGIN + '/writing/', link)
        parsed = urlsplit(url)
        if parsed.netloc == 'fieldlight.com' and re.fullmatch(r'/writing/[^/]+/', parsed.path):
            known.setdefault(ORIGIN + parsed.path, '')
    for url in items:
        known.setdefault(url, items[url].get('title', ''))
    for url, title in known.items():
        parsed = urlsplit(url)
        if parsed.netloc != 'fieldlight.com' or '..' in PurePosixPath(parsed.path).parts:
            raise ValueError(f'Publication URL is outside Fieldlight: {url}')
        path = site / parsed.path.lstrip('/') / 'index.html'
        if not path.is_file():
            raise ValueError(f'Publication reading page is missing: {url}')
        page = metadata(path)
        item = items.setdefault(url, {
            'id': url, 'url': url,
            'title': title or page.meta.get('og:title', ''),
            'summary': page.meta.get('description', page.meta.get('og:description', '')),
            'authors': [AUTHOR],
        })
        if not item.get('title'):
            raise ValueError(f'Publication has no title: {url}')
        image = page.meta.get('og:image')
        if not item.get('image') and image and safe_url(urljoin(url, image)):
            item['image'] = urljoin(url, image)
        item['_image_alt'] = page.meta.get('og:image:alt', '')
        if page.source and safe_url(page.source):
            item['_source_url'] = page.source
        if not item.get('date_published'):
            date = page.meta.get('article:published_time')
            if not date:
                for block in page.jsonld:
                    for record in schema_records(block):
                        if record.get('datePublished'):
                            date = record['datePublished']
                            break
                    if date:
                        break
            if date:
                date_value(date)
                # JSON Feed requires RFC 3339. Retain date-only precision for display.
                item['date_published'] = date if 'T' in date else date + 'T00:00:00Z'
                if 'T' not in date:
                    item['_date_precision'] = 'day'
        if item.get('date_published'):
            date_value(item['date_published'])
        item.setdefault('content_text', item.get('summary', ''))
        item['_kind'] = 'publication'
    return baseline, sorted(items.values(), key=sort_key)


def sort_key(item):
    date = item.get('date_published')
    return (not bool(date), -date_value(date).timestamp() if date else 0, item.get('title', '').casefold())


LINKS = re.compile(r'\[([^\]\n]+)\]\((https?://[^\s)]+)\)|(https?://[^\s<>]+)')


def inline_text(value):
    pieces, end = [], 0
    for match in LINKS.finditer(value):
        pieces.append(escape(value[end:match.start()]))
        label, target = (match[1], match[2]) if match[2] else (match[3], match[3])
        suffix = ''
        if not match[2]:
            target = target.rstrip('.,;:!?)')
            suffix = match[3][len(target):]
            label = target
        if safe_url(target):
            pieces.append(f'<a href="{escape(target, quote=True)}" rel="noopener noreferrer">{escape(label)}</a>{escape(suffix)}')
        else:
            pieces.append(escape(match[0]))
        end = match.end()
    pieces.append(escape(value[end:]))
    return ''.join(pieces).replace('\n', '<br>\n')


def post_content(body, images, *, absolute=False):
    paragraphs = [f'<p>{inline_text(p)}</p>' for p in re.split(r'\n\s*\n', body.strip()) if p.strip()]
    for image in images:
        src = (ORIGIN if absolute else '') + '/' + image['path']
        paragraphs.append(f'<figure class="stream-photo"><img src="{escape(src, quote=True)}" alt="{escape(image["alt"], quote=True)}" loading="lazy" decoding="async"></figure>')
    return '\n'.join(paragraphs)


def composer_content_hash(post):
    """Match the browser's UTF-8 JSON.stringify payload, independently of stored hashes."""
    value = {'title': post.get('title', ''), 'body': post['body'],
             'images': [{'path': image['path'], 'alt': image['alt']} for image in post['images']]}
    # JSON.stringify escapes lone surrogates but leaves ordinary Unicode intact.
    encoded = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8', 'backslashreplace')
    return hashlib.sha256(encoded).hexdigest()


def read_posts(source):
    posts_dir = source / 'stream/posts'
    if not posts_dir.is_dir() or posts_dir.is_symlink():
        raise ValueError(f'Canonical post directory is missing: {posts_dir}')
    posts, media, ids = [], {}, set()
    for record in sorted(posts_dir.glob('*.json')):
        if record.is_symlink():
            raise ValueError(f'Post record must not be a symbolic link: {record.name}')
        post = json.loads(record.read_text())
        post_id = post.get('id', '')
        if not isinstance(post_id, str) or not POST_ID.fullmatch(post_id) or post_id in ids:
            raise ValueError(f'Invalid or duplicate post ID in {record.name}')
        ids.add(post_id)
        published = post.get('published_at')
        updated = post.get('updated_at', published)
        if date_value(updated, strict=True) < date_value(published, strict=True):
            raise ValueError(f'Update precedes publication: {post_id}')
        body, title, images = post.get('body', ''), post.get('title', ''), post.get('images', [])
        if not isinstance(body, str) or not isinstance(title, str) or not isinstance(images, list):
            raise ValueError(f'Invalid post text or images: {post_id}')
        if not body.strip() and not images:
            raise ValueError(f'Empty post: {post_id}')
        source_url = post.get('source_url', '')
        if not safe_url(source_url) or urlsplit(source_url).netloc != 'github.com' or not urlsplit(source_url).path.startswith('/annimch04/public-writing/blob/'):
            raise ValueError(f'Post requires its canonical public-writing source URL: {post_id}')
        for image in images:
            relative = image.get('path', '')
            path = PurePosixPath(relative)
            if not isinstance(relative, str) or path.is_absolute() or '..' in path.parts or len(path.parts) != 4 or path.parts[:3] != ('stream', 'media', post_id):
                raise ValueError(f'Image path is outside this post: {post_id}')
            if path.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'}:
                raise ValueError(f'Unsupported image type: {relative}')
            if not isinstance(image.get('alt'), str) or not image['alt'].strip():
                raise ValueError(f'Image requires alternative text: {relative}')
            original = source / relative
            if (not original.is_file() or any(part.is_symlink() for part in [source / 'stream', source / 'stream/media', original.parent, original])
                    or not original.resolve().is_relative_to((source / 'stream/media').resolve())):
                raise ValueError(f'Image is missing or outside canonical media: {relative}')
            media[relative] = original.read_bytes()
            if post.get('authoring') == 'fieldlight-composer':
                expected_name = hashlib.sha256(media[relative]).hexdigest()[:24] + path.suffix
                if path.suffix not in {'.jpg', '.png'} or path.name != expected_name:
                    raise ValueError(f'Composer photograph content does not match its filename: {relative}')
        url = f'{ORIGIN}/stream/posts/{post_id}/'
        item = {
            'id': url, 'url': url, 'date_published': published, 'date_modified': updated,
            'content_html': post_content(body, images, absolute=True),
            'content_text': body, 'authors': [AUTHOR],
            '_kind': 'post', '_post_id': post_id, '_source_url': source_url,
            '_body_html': post_content(body, images),
            '_issue_url': post.get('issue_url'),
        }
        if post.get('authoring') == 'fieldlight-composer':
            item['_fieldlight_content_hash'] = composer_content_hash(post)
        elif post.get('content_hash'):
            # Historical issue hashes cover the original issue Markdown, including
            # attachment links; retain that protocol for existing issue workflows.
            item['_fieldlight_content_hash'] = post['content_hash']
        if title.strip():
            item['title'] = title
        if images:
            item['image'] = ORIGIN + '/' + images[0]['path']
        posts.append(item)
    return sorted(posts, key=sort_key), media


def feed_json(baseline, items, *, everything):
    result = {key: deepcopy(value) for key, value in baseline.items() if key != 'items'}
    if everything:
        result.update(title='Fieldlight — Everything', home_page_url=ORIGIN + '/stream/', feed_url=ORIGIN + '/stream/feed.json', description='Short posts, photographs, essays, research, and fiction by Anni McHenry.', authors=[AUTHOR])
    result['items'] = [{key: deepcopy(value) for key, value in item.items() if not key.startswith('_') or key == '_fieldlight_content_hash'} for item in items]
    return json_bytes(result)


def rss_feed(baseline, items, *, everything):
    root = ET.Element('rss', {'version': '2.0'})
    channel = ET.SubElement(root, 'channel')
    title = 'Fieldlight — Everything' if everything else baseline['title']
    description = 'Short posts, photographs, essays, research, and fiction by Anni McHenry.' if everything else baseline['description']
    for key, value in [('title', title), ('link', ORIGIN + '/stream/' if everything else baseline['home_page_url']), ('description', description), ('language', 'en-us')]:
        ET.SubElement(channel, key).text = value
    ET.SubElement(channel, f'{{{ATOM}}}link', {'href': ORIGIN + ('/stream/feed.xml' if everything else '/feed.xml'), 'rel': 'self', 'type': 'application/rss+xml'})
    for item in items:
        entry = ET.SubElement(channel, 'item')
        if item.get('title'):
            ET.SubElement(entry, 'title').text = item['title']
        ET.SubElement(entry, 'link').text = item['url']
        old = item.get('_rss', {})
        ET.SubElement(entry, 'guid', old.get('guid_attributes', {'isPermaLink': 'true'})).text = old.get('guid', item['id'])
        if item.get('date_published'):
            ET.SubElement(entry, 'pubDate').text = old.get('pubDate') or format_datetime(date_value(item['date_published']).astimezone(timezone.utc))
        if old.get('author'):
            ET.SubElement(entry, 'author').text = old['author']
        if item['_kind'] == 'post':
            ET.SubElement(entry, 'description').text = item['content_html']
            ET.SubElement(entry, f'{{{CONTENT}}}encoded').text = item['content_html']
        else:
            ET.SubElement(entry, 'description').text = item.get('summary', '')
    ET.indent(root, space='  ')
    return ET.tostring(root, encoding='utf-8', xml_declaration=True) + b'\n'


def card(item, view='everything', *, individual=False):
    kind = item['_kind']
    url = escape(item['url'].removeprefix(ORIGIN), quote=True)
    date = item.get('date_published')
    date_html = f'<time datetime="{escape(date, quote=True)}">{date_label(date)}</time>' if date else '<span>Earlier publication</span>'
    title = item.get('title', '')
    title_html = f'<h2><a href="{url}">{escape(title)}</a></h2>' if title else ''
    if individual and title:
        title_html = f'<h1>{escape(title)}</h1>'
    if kind == 'post':
        if individual and not title:
            title_html = f'<h1 class="visually-hidden">Post from {date_label(date)}</h1>'
        content = title_html + '<div class="stream-post-body">' + item['_body_html'] + '</div>'
        footer = f'<a href="{url}">Permalink</a><a href="{escape(item["_source_url"], quote=True)}">Source record ↗</a>'
    else:
        image = ''
        if item.get('image') and safe_url(item['image']):
            image = f'<a class="stream-publication-image" href="{url}" tabindex="-1" aria-hidden="true"><img src="{escape(item["image"], quote=True)}" alt="" loading="lazy" decoding="async"></a>'
        content = '<div class="stream-publication-copy">' + title_html + f'<p>{escape(item.get("summary", ""))}</p>' + f'<a class="stream-read" href="{url}">Read the publication <span aria-hidden="true">↗</span></a></div>' + image
        footer = ''
    hidden = ' hidden' if kind == 'post' and view == 'publications' else ''
    post_id = f' id="{item["_post_id"]}"' if kind == 'post' else ''
    return f'<article class="stream-card stream-card--{kind}" data-kind="{kind}"{post_id}{hidden}><div class="stream-meta"><span>{"Post" if kind == "post" else "Publication"}</span>{date_html}</div><div class="stream-card-content">{content}</div>' + (f'<footer class="stream-post-footer">{footer}</footer>' if footer else '') + '</article>'


def render(template, replacements):
    for key, value in replacements.items():
        template = template.replace('{{' + key + '}}', value)
    if re.search(r'{{[A-Z_]+}}', template):
        raise ValueError('Unfilled template field')
    return template.encode()


def build_outputs(site, source):
    baseline, publications = publication_catalog(site)
    posts, media = read_posts(source)
    items = sorted(publications + posts, key=sort_key)
    template = (site / 'scripts/templates/stream.html').read_text()
    outputs = dict(media)
    dated = [item for item in items if item.get('date_published')]
    earlier = [item for item in publications if not item.get('date_published')]
    earlier_html = ''.join(card(item) for item in earlier)
    for view, location in [('everything', 'stream/index.html'), ('publications', 'stream/publications/index.html')]:
        earlier_section = f'<details class="stream-earlier"><summary><span>Earlier publications</span><span>{len(earlier)} works</span></summary><p class="stream-earlier-intro">Public work from the archive, without a recorded publication date.</p><div class="stream-earlier-list">{earlier_html}</div></details>' if earlier else ''
        path = '/stream/' if view == 'everything' else '/stream/publications/'
        visible = len(items) if view == 'everything' else len(publications)
        outputs[location] = render(template, {
            'TITLE': 'Fieldlight — ' + ('Everything' if view == 'everything' else 'Publications'),
            'DESCRIPTION': 'Short posts, photographs, essays, research, and fiction by Anni McHenry.',
            'CANONICAL': ORIGIN + path, 'VIEW': view,
            'EVERYTHING_CURRENT': ' aria-current="page"' if view == 'everything' else '',
            'PUBLICATIONS_CURRENT': ' aria-current="page"' if view == 'publications' else '',
            'CARDS': '\n'.join(card(item, view) for item in dated), 'EARLIER': earlier_section,
            'COUNT': str(visible), 'EVERYTHING_COUNT': str(len(items)), 'PUBLICATIONS_COUNT': str(len(publications)),
        })
    post_template = (site / 'scripts/templates/stream-post.html').read_text()
    for post in posts:
        title = post.get('title') or 'Post from ' + date_label(post['date_published'])
        outputs[f'stream/posts/{post["_post_id"]}/index.html'] = render(post_template, {
            'TITLE': escape(title + ' | Fieldlight', quote=True), 'DESCRIPTION': escape(post['content_text'][:250] or 'A photograph by Anni McHenry.', quote=True),
            'CANONICAL': post['url'], 'CARD': card(post, individual=True),
            'IMAGE_META': f'<meta property="og:image" content="{escape(post["image"], quote=True)}">' if post.get('image') else '',
        })
    outputs.update({
        'feed.json': feed_json(baseline, publications, everything=False),
        'feed.xml': rss_feed(baseline, publications, everything=False),
        'stream/feed.json': feed_json(baseline, items, everything=True),
        'stream/feed.xml': rss_feed(baseline, items, everything=True),
    })
    return outputs, len(posts), len(publications)


def stale_outputs(site, outputs):
    stale = []
    for directory in ['stream/posts', 'stream/media']:
        folder = site / directory
        if folder.exists():
            for path in folder.rglob('*'):
                if path.is_file() and path.relative_to(site).as_posix() not in outputs:
                    stale.append(path.relative_to(site).as_posix())
    return sorted(stale)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Canonical public-writing checkout')
    parser.add_argument('--check', action='store_true', help='Verify outputs without modifying the website')
    parser.add_argument('--manifest', type=Path, help='Write generated/removed paths to JSON outside the website')
    args = parser.parse_args()
    try:
        if args.manifest and args.manifest.resolve().is_relative_to(SITE):
            raise ValueError('--manifest must be outside the website checkout')
        outputs, post_count, publication_count = build_outputs(SITE, args.source.resolve())
        stale = stale_outputs(SITE, outputs)
        changed = [name for name, content in outputs.items() if not (SITE / name).is_file() or (SITE / name).read_bytes() != content]
        if args.manifest:
            args.manifest.parent.mkdir(parents=True, exist_ok=True)
            args.manifest.write_bytes(json_bytes({'version': 1, 'generated_paths': sorted(outputs), 'removed_paths': stale}))
        if args.check:
            if changed or stale:
                print('Stream output is out of date:\n' + '\n'.join(changed + stale), file=sys.stderr)
                return 1
        else:
            for name, content in outputs.items():
                destination = SITE / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(content)
            for name in stale:
                (SITE / name).unlink()
        print(f'Stream {"verified" if args.check else "built"}: {post_count} posts, {publication_count} publications; {len(outputs)} generated files.')
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f'Stream build failed: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
