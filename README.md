[![Tests](https://github.com/samthor/duckql/actions/workflows/node.js.yml/badge.svg)](https://github.com/samthor/duckql/actions/workflows/node.js.yml)

DuckQL is an untyped GraphQL server that lets you write JS to resolve queries without a schema.
It's a useful layer to build custom resolvers or as a way of unifying other GraphQL servers.

## Why?

GraphQL is an overloaded concept.
It consists of two wholly unrelated parts:

* a simple query language
* a complex type system

GraphQL queries don't know or care about the underlying types that they might resolve.
For example, take a list query:

```gql
query Foo($filter: Filter!) {
  listFoo(filter: $filter) {
    items {
      id
      name
      fooProp
    }
  }
}
```

This query knows nothing about what a `Foo` is, does not specify that `items` must be returned as a list, nor the `Filter` type we expect as a variable.
Yet, using Apollo requires us to specify a whole schema just to handle a request like this.

## Usage

DuckQL parses incoming GraphQL queries (via the core `graphql` package) and parses them into [a `ResolverContext` type](src/types.d.ts):

```js
import { DuckQLServer } from 'duckql';

const gqlServer = new DuckQLServer({
  resolver(context) {
    const out = { data: {} };

    if ('me' in context.selection.sub) {
      out.data['me'] = { firstName: 'Sam', lastName: 'Thor' };
    }

    return out;
  },
});

const out = await gqlServer.handle({
  query: `query { me { firstName lastName }}`,
});
```

### Other Helpers

DuckQL can also process a query synchronously into a `ResolverContext`:

```js
import { buildContext } from 'duckql';
const context = buildContext({ query: `{ foo }` });
```

Or it can handle HTTP requests directly (on "/graphql" with method "POST"), using e.g., [Polka](https://github.com/lukeed/polka):

```js
import polka from 'polka';
import { DuckQLServer } from 'duckql';
const gqlServer = new DuckQLServer({
  resolver(context) { /* TODO */ },
});

polka()
  .post('/graphql', gqlServer.httpHandle)
  // or
  .use(gqlServer.buildMiddlware())
  .listen(3000);
```

### Variable Interpolation

DuckQL interpolates any GraphQL variables it finds, like `$foo`.
For example, for a request like:

```js
const request = {
  variables: {
    'x': 'hi!',
  },
  query: `query($x: String, $y: Number = 123) { listFoo(message: $x, size: $y) }`,
}
```

The processed selection of `listFoo` will already contain args `{ message: "hi!", size: 123 }`.
Missing or unresolved variables are a parse error and will through `GraphQLQueryError` from this package.

## API

The `ResolverContext` is an object which wraps up the selections of your query in a structured way.
Most importantly, it has a property `selection`, which contains a recursive type `SelectionNode`:

```ts
export type SelectionNode = {
  args?: { [key: string]: GraphQLType };
  directives?: any[];
  sub?: SelectionSet;
  node: FieldNode;
};
export type SelectionSet = { [key: string]: SelectionNode };
```

For example, if the user made a query for `{ listBar { bar(x: 123) { zing } } }`, then `context.selection` will look like:

```js
({
  node: ...,
  sub: {
    'listBar': {
      node: ...,
      sub: {
        'bar': {
          node: ...,
          args: { 'x': 123 },
          sub: {
            'zing': {
              node: ...,
            },
          },
        },
      },
    },
  },
})
```

Importantly, each sub-tree contains a node which can be used to reproduce a sub-tree of the original query.
This can be useful to forward these queries to another server _without_ having to care about the schema.
For example:

```js
import { print } from 'graphql';
const q = print(context.sub['listBar'].sub['bar'].node);
q === `bar(x: 123) {
  zing
}`;
```

### Other Context Properties

As well as the selection, the context also contains:

* `operation`: one of 'query', 'mutation' or 'subscription'
* `operationName`: the operation name in e.g., "query Foo {" would be "Foo", or the blank string for default/none
* `maxDepth`: the maximum depth of selection (useful to catch abuse via deeply nested queries)
* `node`: the original GraphQL AST node, _without_ variable interpolation

## Missing Features

DuckQL does not yet support:

* Fragments: it will treat these as an invalid query
* Directives: these are silently ignored, but remain in the AST to be forwarded
