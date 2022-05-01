
// @ts-ignore
import test from 'node:test';
import * as assert from 'node:assert';
import { buildContext, GraphQLQueryError, GraphQLServer } from '../src/graphql';
import { ResolverContext } from '../src/types';
import * as http from 'http';
import fetch from 'node-fetch';

test('build', () => {
  let context: ResolverContext;

  context = buildContext({
    query: `{_}`, // smallest possible query
  });
  assert.deepEqual(context.operation, 'query')
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
  assert.deepEqual(context.operation, 'query')
  assert.strictEqual(context.maxDepth, 3);
  assert.deepStrictEqual(Object.keys(context.selection.sub), ['doThing', 'someOtherThing']);
  assert.deepStrictEqual(context.selection.sub['doThing'].args, {
    'id': [5],
  }, 'Variable should have been interpolated');
  assert.deepEqual(context.selection.sub['someOtherThing'].args, undefined, 'Has no args');
});

test('too long server', () => {
  let calls = 0;

  const s = new GraphQLServer({
    resolver() {
      ++calls;
      return { data: null };
    },
    maxQueryLength: 10,
  });

  s.handle({ query: '{_}' });
  assert.strictEqual(calls, 1);

  assert.throws(() => {
    s.handle({ query: '{ longerThan10Characters }' });
  }, (err) => err instanceof GraphQLQueryError);
  assert.strictEqual(calls, 1);
});

test('build mutation', () => {
  let context: ResolverContext;

  context = buildContext({
    query: `mutation {_}`,
  });
  assert.deepEqual(context.operation, 'mutation')
});

test('server', async () => {
  const handlerQueue: http.RequestListener[] = [];

  // Awkwardly create a HTTP server for test which will just run handlers as pushed into the queue.
  const server = http.createServer(async (req, res) => {
    const next = handlerQueue.shift();
    if (!next) {
      res.statusCode = 500;
    } else {
      await next(req, res) as any;
    }
    res.end();
  });

  const graphqlServer = new GraphQLServer({
    resolver(context) {
      return {
        data: {
          randomValue: 42,
          operationName: context.operationName,
        },
      };
    },
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.on('listening', () => resolve());
      server.on('error', reject);
      server.listen();
    });
    const address = server.address();
    if (typeof address !== 'object') {
      throw new Error(`must be object address`)
    }
    const { port } = address;

    handlerQueue.push(graphqlServer.httpHandle);

    const response = await fetch(`http://localhost:${port}/graphql`, {
      method: 'POST',
      body: JSON.stringify({
        query: 'query ExpectedOperationName {_}'
      }),
    });
    const json = await response.json();

    assert.deepStrictEqual(json, {
      data: {
        randomValue: 42,
        operationName: 'ExpectedOperationName',
      },
    });

  } finally {
    server.close();
  }
});
