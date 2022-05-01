import { GraphQLQueryError } from '../index';
import { Kind } from 'graphql';
import type { GraphQLType, GraphQLVariables } from '../types';
import type { ValueNode, ObjectFieldNode } from 'graphql';

/**
 * Convert the GraphQL AST node {@link ValueNode} to a regular JS variable.
 *
 * This uses {@link Symbol} to represent an `ENUM`.
 */
export function convertNodeToVar(arg: ValueNode, variables: GraphQLVariables = {}): GraphQLType {
  switch (arg.kind) {
    case Kind.NULL:
      // This is expressed like an enum but matches literal "null" (lowercase only).
      return null;
    case Kind.VARIABLE: {
      const out = variables[arg.name.value];
      if (out === undefined) {
        throw new GraphQLQueryError(`Could not resolve: $${arg.name.value}`);
      }

      // GraphQL's values are a subset of JSON so we don't expect values to be unusable but check
      // just in case...
      convertVarToNode(out);

      return out;
    }
    case Kind.OBJECT:
      return Object.fromEntries(arg.fields.map((field) =>
        [field.name.value, convertNodeToVar(field.value, variables)]
      ));
    case Kind.LIST:
      return arg.values.map((v) => convertNodeToVar(v, variables));
    case Kind.ENUM:
      // This is if a string is included without quotes in our query.
      return Symbol(arg.value);
    case Kind.INT:
      return parseInt(arg.value);
    case Kind.FLOAT:
      return parseFloat(arg.value);
    case Kind.STRING:
    case Kind.BOOLEAN:
      return arg.value;
  }

  // Should never get here
  throw new Error(`GraphQL type unsupported: ${JSON.stringify(arg)}`);
}

/**
 * Converts a regular JS variable of supported type to a GraphQL AST {@link ValueNode}.
 */
export function convertVarToNode(value: GraphQLType): ValueNode {
  if (value === null) {
    return {
      kind: Kind.NULL,
    };
  }

  if (Array.isArray(value)) {
    return {
      kind: Kind.LIST,
      values: value.map((v) => convertVarToNode(v)),
    };
  }

  switch (typeof value) {
    case 'symbol':
      if (!value.description) {
        throw new GraphQLQueryError(`Cannot coerce undescribed Symbol to GraphQL: ${String(value)}`);
      }
      return {
        kind: Kind.ENUM,
        value: value.description,
      };

    case 'object': {
      if (!value) {
        throw new GraphQLQueryError(`Cannot parse null object: ${JSON.stringify(value)}`);
      }
      const entries = Object.entries(value).map(([name, value]) => {
        return {
          kind: Kind.OBJECT_FIELD,
          name: {
            kind: Kind.NAME,
            value: name,
          },
          value: convertVarToNode(value),
        } as ObjectFieldNode;
      });
      return {
        kind: Kind.OBJECT,
        fields: entries,
      };
    }

    case 'boolean':
      return {
        kind: Kind.BOOLEAN,
        value,
      };

    case 'number':
      if (~~value !== value) {
        return {
          kind: Kind.FLOAT,
          value: value.toString(),
        };
      }
    // fall-through

    case 'bigint':
      return {
        kind: Kind.INT,
        value: value.toString(),
      };

    case 'string':
      return {
        kind: Kind.STRING,
        value,
      };
  }

  // Should never get here
  throw new GraphQLQueryError(`cannot convert JS value to GraphQL object: ${JSON.stringify(value)}`);
}
