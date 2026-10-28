import assert from 'node:assert/strict';
import test from 'node:test';
import { slugify, isValidLabel, buildFqdn } from '../src/core/util/slug.ts';

test('slugify lower-cases and keeps letters and digits', () => {
  assert.equal(slugify('Feature'), 'feature');
  assert.equal(slugify('myApp2'), 'myapp2');
  assert.equal(slugify('123'), '123');
});

test('slugify replaces slashes and other characters', () => {
  assert.equal(slugify('feature/login'), 'feature-login');
  assert.equal(slugify('feature/login/with/many/parts'), 'feature-login-with-many-parts');
  assert.equal(slugify('feat_x.1'), 'feat-x-1');
  assert.equal(slugify('a  b'), 'a-b');
});

test('slugify collapses repeats and trims dashes', () => {
  assert.equal(slugify('///a///b///'), 'a-b');
  assert.equal(slugify('---a---'), 'a');
  assert.equal(slugify('a--b'), 'a-b');
});

test('slugify truncates to 63 characters and keeps a valid tail', () => {
  const long = 'x'.repeat(100);
  assert.equal(slugify(long).length, 63);
  const longWithDash = `${'y'.repeat(62)}-tail`;
  const result = slugify(longWithDash);
  assert.ok(result.length <= 63);
  assert.ok(!result.endsWith('-'));
  assert.ok(isValidLabel(result));
});

test('slugify folds unicode to ascii-ish labels', () => {
  assert.equal(slugify('Ünïcode'), 'unicode');
  assert.equal(slugify('naïve—dash'), 'naive-dash');
  assert.equal(slugify('日本語'), '');
  assert.ok(isValidLabel(slugify('日本語abc')));
});

test('isValidLabel rejects empty and malformed labels', () => {
  assert.ok(isValidLabel('feature-login'));
  assert.ok(!isValidLabel(''));
  assert.ok(!isValidLabel('-leading'));
  assert.ok(!isValidLabel('trailing-'));
  assert.ok(!isValidLabel('Upper'));
});

test('buildFqdn places the branch first', () => {
  assert.equal(buildFqdn('alpha', 'feature/login', 'home.malarstrom.com'), 'feature-login.alpha.home.malarstrom.com');
});
