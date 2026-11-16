"""Deployment checks for the public/private boundary and repeat-run behavior."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET

SITE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_pages', SITE / 'scripts/prepare-pages.py')
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)


class PagesTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.site = self.root / 'site'
        self.site.mkdir()
        subprocess.run(['git', 'init', '-q', str(self.site)], check=True)

    def commit_files(self, files):
        for name, content in files.items():
            target = self.site / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)
        subprocess.run(['git', '-C', str(self.site), 'add', '.'], check=True)
        subprocess.run(['git', '-C', str(self.site), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.org', 'commit', '-q', '-m', 'Test fixture'], check=True)

    def test_package_contains_reader_assets_and_no_source_or_credentials(self):
        self.commit_files({
            'index.html': '<h1>Public</h1>', 'stream/index.html': '<h1>Stream</h1>',
            'continuity/data.json': '{}', 'assets/photo.jpg': 'photo',
            'post/index.html': 'Public author doorway', 'CNAME': 'fieldlight.com',
            'docs/private-notes.html': 'DO NOT SHIP', 'scripts/templates/stream.html': 'DO NOT SHIP',
            'tests/fixture.json': 'DO NOT SHIP', '.github/workflows/publish.yml': 'DO NOT SHIP',
            'stream/publications.json': 'DO NOT SHIP', 'README.md': 'DO NOT SHIP',
        })
        # An untracked local artifact must never enter the package.
        (self.site / 'untracked.html').write_text('DO NOT SHIP')
        target = self.root / 'package'
        pages.package_site(self.site, self.site, target)
        contents = {p.relative_to(target).as_posix() for p in target.rglob('*') if p.is_file()}
        self.assertEqual(contents, {'index.html', 'stream/index.html', 'continuity/data.json', 'assets/photo.jpg', 'post/index.html', 'CNAME', '.nojekyll', 'stream/deployment.json'})
        marker = json.loads((target / 'stream/deployment.json').read_text())
        self.assertEqual(marker['site_revision'], pages.revision(self.site))
        self.assertTrue(all('DO NOT SHIP' not in p.read_text() for p in target.rglob('*') if p.is_file()))

    def test_identical_revisions_skip_but_missing_failed_or_forced_runs_retry(self):
        marker = {'version': 1, 'site_revision': 'site-a', 'source_revision': 'source-a'}
        self.assertFalse(pages.needs_deployment('site-a', 'source-a', marker))
        self.assertTrue(pages.needs_deployment('site-a', 'source-b', marker))
        self.assertTrue(pages.needs_deployment('site-b', 'source-a', marker))
        self.assertTrue(pages.needs_deployment('site-a', 'source-a', {}))
        self.assertTrue(pages.needs_deployment('site-a', 'source-a', marker, force=True))

    def test_manifest_cannot_stage_other_website_or_hidden_files(self):
        allowed = ['feed.xml', 'stream/index.html', 'stream/posts/post-123/index.html', 'stream/media/post-123/photo.jpg']
        self.assertEqual(pages.validate_manifest({'version': 1, 'generated_paths': allowed, 'removed_paths': []}), sorted(allowed))
        for name in ['index.html', '../source/private.txt', '.github/workflows/publish.yml', 'stream/media/post-123/../secret', 'stream/media/post-123/.secret']:
            with self.assertRaises(ValueError, msg=name):
                pages.validate_manifest({'version': 1, 'generated_paths': [name], 'removed_paths': []})

    def test_sitemap_is_stable_and_excludes_template_and_author_doorway(self):
        self.commit_files({'index.html': 'Public', 'stream/index.html': 'Stream', 'post/index.html': 'Doorway', 'scripts/templates/stream.html': 'Template'})
        pages.update_sitemap(self.site, self.site, [])
        first = (self.site / 'sitemap.xml').read_bytes()
        pages.update_sitemap(self.site, self.site, [])
        self.assertEqual(first, (self.site / 'sitemap.xml').read_bytes())
        urls = [x.text for x in ET.fromstring(first).iter(f'{{{pages.SITEMAP}}}loc')]
        self.assertEqual(urls, ['https://fieldlight.com/', 'https://fieldlight.com/stream/'])

    def test_symbolic_link_cannot_publish_a_non_public_file(self):
        self.commit_files({'index.html': 'Public', 'stream/index.html': 'Stream', 'docs/private.txt': 'Private'})
        (self.site / 'assets').mkdir()
        (self.site / 'assets/leak.txt').symlink_to('../docs/private.txt')
        subprocess.run(['git', '-C', str(self.site), 'add', 'assets/leak.txt'], check=True)
        with self.assertRaises(ValueError):
            pages.package_site(self.site, self.site, self.root / 'package')


if __name__ == '__main__':
    unittest.main()
