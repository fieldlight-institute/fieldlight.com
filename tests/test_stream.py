"""Behavioral checks for the publication boundary and canonical short-post rendering."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

SITE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_stream', SITE / 'scripts/build-stream.py')
stream = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stream)


class StreamTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.source = Path(self.folder.name)
        (self.source / 'stream/posts').mkdir(parents=True)

    def post(self, **changes):
        post = {
            'id': 'post-123', 'published_at': '2026-11-16T15:30:00Z',
            'updated_at': '2026-11-16T15:31:00Z', 'body': 'Test-only text.',
            'images': [],
            'source_url': 'https://github.com/annimch04/public-writing/blob/main/stream/posts/post-123.json',
            'issue_url': 'https://github.com/annimch04/public-writing/issues/123',
            'content_hash': 'test-content-hash',
        }
        post.update(changes)
        (self.source / 'stream/posts/post-123.json').write_text(json.dumps(post))
        return post

    def test_empty_source_contains_only_existing_publications(self):
        outputs, count, publications = stream.build_outputs(SITE, self.source)
        self.assertEqual(count, 0)
        self.assertGreaterEqual(publications, 61)
        everything = json.loads(outputs['stream/feed.json'])['items']
        self.assertEqual(len(everything), publications)
        self.assertTrue(all('/stream/posts/' not in entry['url'] for entry in everything))
        self.assertIn('Earlier publications', outputs['stream/index.html'].decode())

    def test_existing_feed_identity_prose_and_dates_survive(self):
        outputs, _, _ = stream.build_outputs(SITE, self.source)
        baseline = json.loads((SITE / 'stream/publications.json').read_text())['items']
        generated = {item['url']: item for item in json.loads(outputs['feed.json'])['items']}
        rss = {item.findtext('link'): item for item in ET.fromstring(outputs['feed.xml']).findall('./channel/item')}
        for old in baseline:
            new = generated[old['url']]
            for field in ['id', 'title', 'summary', 'date_published', 'date_modified']:
                self.assertEqual(old.get(field), new.get(field), (old['url'], field))
            self.assertEqual(old['_rss']['guid'], rss[old['url']].findtext('guid'))
            self.assertEqual(old['_rss']['guid_attributes'], rss[old['url']].find('guid').attrib)
            self.assertEqual(old['_rss'].get('pubDate'), rss[old['url']].findtext('pubDate'))
        undated = 'https://fieldlight.com/institute/governed-archive-acquisition/'
        self.assertNotIn('date_published', generated[undated])
        self.assertIsNone(rss[undated].find('pubDate'))

    def test_complete_post_is_escaped_and_excluded_from_publications(self):
        body = '<script>alert("hello")</script>\n\nSecond paragraph & a link https://example.org/?a=1&b=2.'
        self.post(title='<b>Title</b>', body=body)
        outputs, _, _ = stream.build_outputs(SITE, self.source)
        everything = json.loads(outputs['stream/feed.json'])['items']
        post = everything[0]
        self.assertEqual(post['date_published'], '2026-11-16T15:30:00Z')
        self.assertEqual(post['_fieldlight_content_hash'], 'test-content-hash')
        self.assertEqual(post['content_text'], body)
        self.assertIn('&lt;script&gt;', post['content_html'])
        self.assertNotIn('<script>', post['content_html'])
        self.assertIn('Second paragraph &amp;', post['content_html'])
        self.assertIn('href="https://example.org/?a=1&amp;b=2"', post['content_html'])
        root_feed = json.loads(outputs['feed.json'])['items']
        self.assertFalse(any(item['id'] == post['id'] for item in root_feed))
        rss = ET.fromstring(outputs['stream/feed.xml']).find('./channel/item')
        self.assertEqual(post['content_html'], rss.findtext(f'{{{stream.CONTENT}}}encoded'))
        page = outputs['stream/posts/post-123/index.html'].decode()
        self.assertIn('&lt;b&gt;Title&lt;/b&gt;', page)
        self.assertIn('Source record', page)
        self.assertIn('data-kind="post" id="post-123" hidden', outputs['stream/publications/index.html'].decode())
        self.assertIn('data-kind="post" id="post-123"><', outputs['stream/index.html'].decode())

    def test_photo_is_copied_and_has_full_feed_url_and_alt_text(self):
        path = 'stream/media/post-123/a-photo.png'
        image = self.source / path
        image.parent.mkdir(parents=True)
        image.write_bytes(b'\x89PNG\r\n\x1a\nfixture')
        self.post(body='', images=[{'path': path, 'alt': 'A window & morning light'}])
        outputs, _, _ = stream.build_outputs(SITE, self.source)
        self.assertEqual(outputs[path], image.read_bytes())
        post = json.loads(outputs['stream/feed.json'])['items'][0]
        self.assertIn('https://fieldlight.com/' + path, post['content_html'])
        self.assertIn('alt="A window &amp; morning light"', post['content_html'])
        self.assertIn('/stream/media/post-123/a-photo.png', outputs['stream/posts/post-123/index.html'].decode())

    def test_missing_source_and_escaping_media_fail_before_output(self):
        with self.assertRaises(ValueError):
            stream.build_outputs(SITE, self.source / 'wrong-checkout')
        self.post(images=[{'path': 'stream/media/post-123/../../secret.png', 'alt': 'Photo'}])
        with self.assertRaises(ValueError):
            stream.build_outputs(SITE, self.source)

    def test_naive_or_backdated_updates_are_rejected(self):
        self.post(published_at='2026-11-16T15:30:00')
        with self.assertRaises(ValueError):
            stream.build_outputs(SITE, self.source)
        self.post(updated_at='2026-11-15T15:30:00Z')
        with self.assertRaises(ValueError):
            stream.build_outputs(SITE, self.source)


if __name__ == '__main__':
    unittest.main()
