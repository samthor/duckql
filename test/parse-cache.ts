
// @ts-ignore
import test from 'node:test';
import * as assert from 'node:assert';
import { ParseCache } from '../src/lib/parse-cache';

test('parseCache', () => {
  const x = new ParseCache(100);

  const node1 = x.parse(`{_}`);
  const node2 = x.parse(`{_}`);

  assert.strictEqual(x.count, 1);
  assert.strictEqual(node1, node2);

  const big1 = x.parse(`
query Foo {
  user {
    firstName
    lastName
    id {
      zing
    }
  }
}
  `);
  const big2 = x.parse(`query Foo {
    user {
      firstName
      lastName
      id {
        zing
      }
    }
  }`);
  assert.strictEqual(x.count, 2);
  assert.strictEqual(big1, big2, 'normalized queries should be the same')

  const anotherBig = x.parse(`query {
    user {
      firstName
      lastName
      id {
        zing
      }
    }
  }`)
  assert.notStrictEqual(anotherBig, big2);
  assert.strictEqual(x.count, 1, 'will evict previous nodes');

  const node3 = x.parse(`{_}`);
  assert.notStrictEqual(node3, node1, 'no longer same tiny node');
  assert.strictEqual(x.count, 2, 'should fit in cache');
});
