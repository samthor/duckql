
// @ts-ignore
import test from 'node:test';
import * as assert from 'node:assert';
import { convertNodeToVar, convertVarToNode } from '../../src/lib/values';
import { Kind } from 'graphql';

test('convertNodeToVar', () => {
  assert.deepStrictEqual(convertNodeToVar({
    kind: Kind.INT,
    value: '123456',
  }), 123456);
  assert.deepStrictEqual(convertNodeToVar({
    kind: Kind.VARIABLE,
    name: {
      kind: Kind.NAME,
      value: 'butt',
    },
  }, { 'butt': [false] }), [false]);
  assert.throws(() => {
    convertNodeToVar({
      kind: Kind.VARIABLE,
      name: {
        kind: Kind.NAME,
        value: 'butt',
      },
    }, { 'not-butt': 123 });
  });
});

test('convertVarToNode', () => {
  assert.deepStrictEqual(convertVarToNode(123), {
    kind: Kind.INT,
    value: '123',
  });
  assert.deepStrictEqual(convertVarToNode(123.0), {
    kind: Kind.INT,
    value: '123',
  });
  assert.deepStrictEqual(convertVarToNode(123.1), {
    kind: Kind.FLOAT,
    value: '123.1',
  });
  assert.deepStrictEqual(convertVarToNode({ o: null, q: 'foo' }), {
    kind: Kind.OBJECT,
    fields: [
      {
        kind: Kind.OBJECT_FIELD,
        name: {
          kind: Kind.NAME,
          value: 'o',
        },
        value: {
          kind: Kind.NULL,
        },
      },
      {
        kind: Kind.OBJECT_FIELD,
        name: {
          kind: Kind.NAME,
          value: 'q',
        },
        value: {
          kind: Kind.STRING,
          value: 'foo',
        },
      },
    ],
  });
  assert.deepStrictEqual(convertVarToNode([true, false, -1234n]), {
    kind: Kind.LIST,
    values: [
      {
        kind: Kind.BOOLEAN,
        value: true,
      },
      {
        kind: Kind.BOOLEAN,
        value: false,
      },
      {
        kind: Kind.INT,
        value: '-1234',
      },
    ],
  });
});
