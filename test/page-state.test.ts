/**
 * The page's refresh policy and its announcements.
 *
 * The rules that decide what happens to the route list, and what a screen
 * reader is told when a route changes state, live in `src/assets/index.js`
 * next to the code that uses them — the browser needs them and the test
 * needs them, so there is one copy of the rule, not two.
 *
 * The file is loaded into a bare context here: it has no `document`, so the
 * page itself does not run. Only the rules are exercised.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'src', 'assets', 'index.js');

interface RefreshPlan {
  observe(ids: string[]): void;
  applied(ids: string[]): void;
  openBand(): void;
  closeBand(): void;
  bandsOpen(): boolean;
  hold(): void;
  held(): boolean;
  decide(): 'apply' | 'patch' | 'defer';
}

interface PageApi {
  sameIds(left: string[], right: string[]): boolean;
  createRefreshPlan(): RefreshPlan;
  stateAnnouncement(branch: string, state: 'up' | 'down'): string;
}

/** Load the shipped script and take the rules out of it. */
function loadPageApi(): PageApi {
  const context: Record<string, unknown> = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(SOURCE, 'utf8'), context, { filename: SOURCE });
  const api = (context as { TraefikPage?: PageApi }).TraefikPage;
  assert.ok(api, 'the page script does not expose its rules');
  return api;
}

test('the script loads without a document, so the rules can be tested', () => {
  const api = loadPageApi();
  assert.equal(typeof api.createRefreshPlan, 'function');
});

test('two lists of ids name the same routes', () => {
  const { sameIds } = loadPageApi();
  assert.equal(sameIds(['a', 'b'], ['a', 'b']), true);
  assert.equal(sameIds(['a', 'b'], ['b', 'a']), true);
  assert.equal(sameIds(['a', 'b'], ['a', 'c']), false);
  assert.equal(sameIds(['a'], ['a', 'b']), false);
});

test('a list that did not change is only patched in place', () => {
  const plan = loadPageApi().createRefreshPlan();
  plan.observe(['alpha/main']);
  plan.applied(['alpha/main']);
  assert.equal(plan.decide(), 'patch');
});

test('a list that changed is applied', () => {
  const plan = loadPageApi().createRefreshPlan();
  plan.observe(['alpha/main']);
  plan.applied([]);
  assert.equal(plan.decide(), 'apply');
});

test('a pending confirmation holds the list until it closes', () => {
  const plan = loadPageApi().createRefreshPlan();

  plan.observe(['alpha/main']);
  plan.applied(['alpha/main']);

  // The user presses Remove: a band opens under the route.
  plan.openBand();
  assert.equal(plan.bandsOpen(), true);

  // A poll sees a route the page does not have yet.
  plan.observe(['alpha/main', 'beta/main']);
  assert.equal(plan.decide(), 'defer', 'the list must not change under an open band');
  assert.equal(plan.held(), true, 'the list must be held, not dropped');

  // The band closes: now the list is applied.
  plan.closeBand();
  assert.equal(plan.bandsOpen(), false);
  assert.equal(plan.decide(), 'apply', 'the held list must be applied once the band is closed');
  assert.equal(plan.held(), false);
});

test('two open bands are two holds', () => {
  const plan = loadPageApi().createRefreshPlan();
  plan.observe(['alpha/main']);
  plan.applied(['alpha/main']);

  plan.openBand();
  plan.openBand();
  plan.closeBand();
  assert.equal(plan.bandsOpen(), true, 'one band is still open');
  plan.observe(['alpha/main', 'beta/main']);
  assert.equal(plan.decide(), 'defer');

  plan.closeBand();
  assert.equal(plan.bandsOpen(), false);
  assert.equal(plan.decide(), 'apply');
});

test('the live region is told what changed', () => {
  const { stateAnnouncement } = loadPageApi();
  assert.equal(stateAnnouncement('feat/index-polish', 'down'), 'feat/index-polish is now down');
  assert.equal(stateAnnouncement('main', 'up'), 'main is now up');
});
