#!/usr/bin/env python3
"""Build and package public Pages content using the website's own GitHub token."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

PUBLIC_SUFFIXES = {'.html', '.css', '.js', '.json', '.xml', '.txt', '.ico', '.svg',
                   '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.pdf',
                   '.mp3', '.mp4', '.m4a', '.wav', '.ogg', '.webm', '.woff', '.woff2', '.ttf', '.otf'}
PRIVATE_PARTS = {'scripts', 'tests', 'docs', 'templates', '__pycache__', 'node_modules'}
GENERATED_PATH = re.compile(r'(?:feed\.(?:json|xml)|stream/(?:index\.html|feed\.(?:json|xml)|publications/index\.html|posts/post-[1-9][0-9]*/index\.html|media/post-[1-9][0-9]*/[^/]+))\Z')
SITEMAP = 'http://www.sitemaps.org/schemas/sitemap/0.9'


def git(site, *args):
    return subprocess.check_output(['git', '-C', str(site), *args], text=True).strip()


def run(site, *args):
    subprocess.run(list(args), cwd=site, check=True)


def revision(site):
    return git(site, 'rev-parse', 'HEAD')


def deployed_revisions():
    request = Request('https://fieldlight.com/stream/deployment.json', headers={'Cache-Control': 'no-cache', 'User-Agent': 'Fieldlight-Pages-Publisher'})
    try:
        with urlopen(request, timeout=25) as response:
            value = json.load(response)
        return value if isinstance(value, dict) and value.get('version') == 1 else {}
    except (HTTPError, URLError, TimeoutError, ValueError, OSError):
        # First publication, missing marker, and a temporarily unreachable site
        # all need a real deployment rather than a false "already published".
        return {}


def needs_deployment(site_revision, source_revision, deployed, *, force=False):
    return force or deployed.get('site_revision') != site_revision or deployed.get('source_revision') != source_revision


def summary(message):
    print(message)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
            output.write(message + '\n')


def public_file(relative):
    path = PurePosixPath(relative)
    if path.is_absolute() or '..' in path.parts or any(part.startswith('.') or part in PRIVATE_PARTS for part in path.parts):
        return False
    if relative == 'stream/publications.json':
        return False  # Preserved generator input, not reader-facing data.
    return relative == 'CNAME' or path.suffix.lower() in PUBLIC_SUFFIXES


def public_files(site):
    files = git(site, 'ls-files', '-z').split('\0')
    return sorted(relative for relative in files if relative and public_file(relative) and (site / relative).is_file())


def validate_manifest(value):
    if value.get('version') != 1:
        raise ValueError('Unexpected generator manifest version')
    result = set()
    for key in ['generated_paths', 'removed_paths']:
        if not isinstance(value.get(key), list):
            raise ValueError(f'Manifest is missing {key}')
        for name in value[key]:
            if not isinstance(name, str) or not GENERATED_PATH.fullmatch(name) or '..' in PurePosixPath(name).parts or PurePosixPath(name).name.startswith('.'):
                raise ValueError(f'Generator manifest names an unowned path: {name!r}')
            result.add(name)
    return sorted(result)


def update_sitemap(site, source, generated_paths):
    """Preserve dates for unchanged pages; never include maintained templates."""
    target = site / 'sitemap.xml'
    previous = {}
    if target.is_file():
        for entry in ET.parse(target).findall(f'{{{SITEMAP}}}url'):
            previous[entry.findtext(f'{{{SITEMAP}}}loc')] = entry.findtext(f'{{{SITEMAP}}}lastmod')
    changed = set(git(site, 'diff', '--name-only').splitlines())
    candidates = set(public_files(site)) | {p for p in generated_paths if (site / p).is_file() and public_file(p)}
    build_date = max(git(site, 'show', '-s', '--format=%cs', 'HEAD'), git(source, 'show', '-s', '--format=%cs', 'HEAD'))
    ET.register_namespace('', SITEMAP)
    root = ET.Element(f'{{{SITEMAP}}}urlset')
    for relative in sorted(candidates):
        path = PurePosixPath(relative)
        if path.suffix != '.html' or path.name.startswith('google') or path.parts[0] == 'post':
            continue
        url = 'https://fieldlight.com/' + (relative[:-10] if relative.endswith('index.html') else relative)
        prior = previous.get(url)
        committed_date = git(site, 'log', '-1', '--format=%cs', '--', relative)
        if relative in changed or not committed_date:
            date = build_date
        else:
            date = max(prior or '', committed_date)
        entry = ET.SubElement(root, f'{{{SITEMAP}}}url')
        ET.SubElement(entry, f'{{{SITEMAP}}}loc').text = url
        ET.SubElement(entry, f'{{{SITEMAP}}}lastmod').text = date
    ET.indent(root, space='  ')
    target.write_bytes(ET.tostring(root, encoding='utf-8', xml_declaration=True) + b'\n')


def package_site(site, source, destination):
    if destination.exists():
        raise ValueError('Package destination must be a new directory')
    destination.mkdir(parents=True)
    for relative in public_files(site):
        original = site / relative
        if original.is_symlink() or not original.resolve().is_relative_to(site.resolve()):
            raise ValueError(f'Public package cannot contain a symbolic link: {relative}')
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        # copyfile creates regular files, so even hard-linked source assets do
        # not produce links in the Pages tar archive.
        shutil.copyfile(original, target)
    (destination / '.nojekyll').write_text('')
    marker = destination / 'stream/deployment.json'
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(json.dumps({'version': 1, 'site_revision': revision(site), 'source_revision': revision(source)}, indent=2) + '\n')
    if not (destination / 'index.html').is_file() or not (destination / 'stream/index.html').is_file():
        raise ValueError('Package is missing a required public page')


def build(site, source, manifest, package):
    if git(site, 'status', '--porcelain'):
        raise ValueError('Publication requires a clean website checkout')
    initial = revision(site)
    run(site, sys.executable, 'scripts/build-stream.py', '--source', str(source), '--manifest', str(manifest))
    owned = validate_manifest(json.loads(manifest.read_text()))
    update_sitemap(site, source, owned)
    run(site, sys.executable, 'scripts/build-stream.py', '--source', str(source), '--check')
    run(site, sys.executable, 'scripts/check-reader-continuity.py')
    run(site, sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py')
    # Do not rebase generated output onto code it was never built against.
    # If an owner pushes while this run builds, abort; the next serialized run
    # starts from current main and generates again before deployment.
    remote = git(site, 'ls-remote', 'origin', 'refs/heads/main').split()[0]
    if remote != initial:
        raise ValueError('Website main advanced during this build; the next run will regenerate current main')
    paths = [path for path in owned + ['sitemap.xml'] if (site / path).exists() or git(site, 'ls-files', '--', path)]
    run(site, 'git', 'add', '-A', '--', *paths)
    if git(site, 'diff', '--cached', '--name-only'):
        run(site, 'git', '-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', 'Update public stream from canonical source')
        run(site, 'git', 'push', 'origin', 'HEAD:main')
        summary('Saved the generated stream and sitemap in the website repository.')
    else:
        summary('Generated content already matches the website repository; no commit needed.')
    package_site(site, source, package)
    summary('Public website artifact prepared. The Pages deployment job must succeed before this revision is live.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'build'])
    parser.add_argument('--site', required=True, type=Path)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--package', type=Path)
    args = parser.parse_args()
    site, source = args.site.resolve(), args.source.resolve()
    try:
        if args.action == 'check':
            required = needs_deployment(revision(site), revision(source), deployed_revisions(), force=os.environ.get('FORCE_DEPLOY') == 'true')
            if os.environ.get('GITHUB_OUTPUT'):
                with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                    output.write(f'required={str(required).lower()}\n')
            summary('Website or canonical source has changed; publication is needed.' if required else 'These website and canonical source revisions are already live; deployment skipped.')
        else:
            if not args.manifest or not args.package:
                parser.error('build requires --manifest and --package')
            if args.package.resolve().is_relative_to(site):
                raise ValueError('Package directory must be outside the website checkout')
            build(site, source, args.manifest.resolve(), args.package.resolve())
        return 0
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'Pages preparation failed: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
