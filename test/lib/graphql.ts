
// @ts-ignore
import test from 'node:test';
import * as assert from 'node:assert';
import { buildContext } from '../../src/graphql';
import { ResolverContext } from '../../src/types';

test('build', () => {
  let context: ResolverContext;

  context = buildContext({
    query: `{_}`, // smallest possible query
  });
  assert.strictEqual(context.maxDepth, 1);
  assert.strictEqual(context.operationName, '');
  assert.deepStrictEqual(Object.keys(context.selection.sub), ['_']);

  context = buildContext({
    query: `
query Whatever($bar: Int = 5) {
  doThing(id: [$bar]) {
    id
    name {
      firstName
      lastName
    }
  }
  someOtherThing
}
    `,
  });
  assert.strictEqual(context.maxDepth, 3);
  assert.deepStrictEqual(Object.keys(context.selection.sub), ['doThing', 'someOtherThing']);
  assert.deepStrictEqual(context.selection.sub['doThing'].args, {
    'id': [5],
  }, 'Variable should have been interpolated');
  assert.deepEqual(context.selection.sub['someOtherThing'].args, undefined, 'Has no args');
});
