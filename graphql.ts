
/**
 * @fileoverview Handles incoming GraphQL queries (via `graphql-tag`) and passes to a single query
 * resolver.
 */

import gql from 'graphql-tag';
import { Kind, ValueNode, OperationDefinitionNode, FieldNode, ObjectFieldNode } from 'graphql';
import type * as http from 'http';

export interface GraphQLRequest {
  operationName?: string;
  query: string;
  variables: GraphQLVariables;
}

export type SelectionNode = {
  args?: { [key: string]: GraphQLType },
  directives?: any[],
  sub?: SelectionSet,
  node: FieldNode,
};
export type SelectionSet = { [key: string]: SelectionNode };

export interface ResolverContext {
  operationName: string;

  /**
   * The raw GraphQL operation being performed.
   */
  node: OperationDefinitionNode;

  selection: SelectionNode;
}

export type GraphQLVariables = { [key: string]: GraphQLType };


/**
 * GraphQL supports these built-in types. Might be useful?!
 *
 * {@link Symbol} is be a proxy for enum values specified in the query.
 */
export type GraphQLType = boolean | bigint | number | string | Symbol | GraphQLType[] | GraphQLVariables | null;


/**
 * Wraps a single resolver and handles GraphQL queries.
 */
export class GraphQLServer {
  #resolver;

  constructor(resolver: (context: ResolverContext) => any) {
    this.#resolver = resolver;
  }

  static convertVarToNode(value: GraphQLType): ValueNode {
    if (value === null) {
      return {
        kind: Kind.NULL,
      };
    }

    if (Array.isArray(value)) {
      return {
        kind: Kind.LIST,
        values: value.map((v) => this.convertVarToNode(v)),
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
            value: this.convertVarToNode(value),
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

  static buildJSArg(arg: ValueNode, variables: GraphQLVariables): GraphQLType {
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
        GraphQLServer.convertVarToNode(out);

        return out;
      }
      case Kind.OBJECT:
        return Object.fromEntries(arg.fields.map((field) =>
          [field.name.value, this.buildJSArg(field.value, variables)]
        ));
      case Kind.LIST:
        return arg.values.map((v) => this.buildJSArg(v, variables));
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
   * Enumerate through all requested fields and interpolate {@link Kind.VARIABLE} into nodes.
   *
   * This must be called with a cloned AST, as it is modified in-place.
   */
  static buildSet(node: FieldNode, variables: GraphQLVariables): SelectionSet | undefined {
    const selections = node.selectionSet?.selections;
    if (!selections) {
      return;
    }

    const set: SelectionSet = {};

    for (const sel of selections) {
      if (sel.kind !== Kind.FIELD) {
        throw new Error(`Fragments are currently unsupported`);
      }

      const o: SelectionNode = {
        node: sel,
      };
      set[sel.name.value] = o;

      if (sel.arguments?.length) {
        // GraphQL doesn't allow selections like "foo()", so having an argument means this is a call.
        const args: GraphQLVariables = {};
        for (const arg of sel.arguments) {
          const jsArg = this.buildJSArg(arg.value, variables);

          // Convert this back again in case it contains VARIABLE, for the caller's easy ability to
          // forward the request onwards.
          // @ts-ignore We've cloned before starting
          arg.value = GraphQLServer.convertVarToNode(jsArg);

          args[arg.name.value] = jsArg;
        }
        o.args = args;
      }

      const sub = this.buildSet(sel, variables);
      if (sub) {
        o.sub = sub;
      }
    }

    return set;
  }

  httpHandle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.url !== '/graphql') {
      res.statusCode = 404;
      return;
    }
    if (req.method !== 'POST') {
      res.statusCode = 405;
      return;
    }

    const body = await new Promise<string>((resolve, reject) => {
      const bufs: Buffer[] = [];
      req.on('data', (chunk: Buffer) => bufs.push(chunk));
      req.on('end', () => resolve(Buffer.concat(bufs).toString('utf-8')));
      req.on('error', reject);
    });

    let json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      res.statusCode = 400;
      return;
    }

    if (!json.query) {
      res.statusCode = 400;
      return;
    }

    const request: GraphQLRequest = {
      operationName: json.operationName || '',
      query: json.query || '',
      variables: json.variables || {},
    };

    let response;
    try {
      response = await this.handle(request);
    } catch (e) {
      if (e instanceof GraphQLQueryError) {
        res.statusCode = 400;
        res.write(e.message);
        return;
      }
      throw e;
    }
    res.write(JSON.stringify(response));
  };

  handle = async (request: GraphQLRequest): Promise<{ data: any }> => {
    // We don't use this as a tag because... we don't need to. Also, it's normalized and cached by
    // graphql-tag, so don't do that again.
    let parsed;
    try {
      parsed = gql(request.query);
    } catch (e) {
      if (e instanceof Error) {
        // This is probably a parse error, which is kind of the user's fault.
        throw new GraphQLQueryError(`Could not parse query: ${e.message}`);
      }
      throw e;
    }
    if (parsed.kind !== Kind.DOCUMENT) {
      throw new GraphQLQueryError(`Got non-document GraphQL kind: ${parsed.kind}`);
    }

    let operationName = request.operationName ?? '';

    // Find the requested definition, or the first definition if no name was specified.
    const defToRun = parsed.definitions.find((def) => {
      if (def.kind !== Kind.OPERATION_DEFINITION) {
        return false;
      } else if (!operationName) {
        return true;  // grab 1st if there's no name
      }
      return 'name' in def && def.name?.value === operationName;
    });
    if (!defToRun || defToRun.kind !== Kind.OPERATION_DEFINITION) {
      throw new GraphQLQueryError(`Could not find definition to run: ${JSON.stringify(operationName)}`);
    }
    operationName = defToRun.name?.value || operationName;
    console.debug(JSON.stringify(defToRun, undefined, 2));

    // Construct variables available to the query based on the top-level query type. Grab either
    // the user-specified variable or their default value.
    const variables: GraphQLVariables = {};
    for (const variableDefinition of defToRun.variableDefinitions ?? []) {
      const name = variableDefinition.variable.name.value;

      if (request.variables[name] !== undefined) {
        variables[name] = request.variables[name];
      } else if (variableDefinition.defaultValue) {
        variables[name] = GraphQLServer.buildJSArg(variableDefinition.defaultValue, {});
      }
    }

    // Pretend that the top-level query or mutation is a single "blank" field.
    const virtualFieldNode: FieldNode = {
      kind: Kind.FIELD,
      name: {
        kind: Kind.NAME,
        value: '',
      },
      selectionSet: cloneAst(defToRun.selectionSet),
    };

    // Convert our selection to a much more sane JS object.
    const set = GraphQLServer.buildSet(virtualFieldNode, variables);
    if (!set) {
      throw new Error(`Outer node should always have valid selectionSet`);
    }

    // Generate a friendly context to pass around.
    const context: ResolverContext = {
      operationName,
      selection: {
        sub: set,
        node: virtualFieldNode,
      },
      node: defToRun,
    };

    // Call our resolver. GraphQL is nested: the very top-level query is a type of request no
    // different to any other, despite what other servers might say.
    const data = await this.#resolver(context);
    return { data };
  };

}


export class GraphQLQueryError extends Error { }


const cloneAst = typeof structuredClone === 'function' ? structuredClone : <T>(x: T): T => JSON.parse(JSON.stringify(x));
