
/**
 * @fileoverview Handles incoming GraphQL queries (via `graphql-tag`) and passes to a single query
 * resolver.
 */

import gql from 'graphql-tag';
import { Kind, ValueNode, SelectionSetNode } from 'graphql';
import type * as http from 'http';

export interface GraphQLRequest {
  operationName?: string;
  query: string;
  variables: { [key: string]: any };
}

export type SelectionSetInner = {
  args?: { [key: string]: GraphQLType },
  directives?: any[],
  sub?: SelectionSet,
};
export type SelectionSet = { [key: string]: SelectionSetInner };

export interface ResolverContext {
  operationName: string;
  selection: SelectionSet;
}


/**
 * GraphQL supports these built-in types. Might be useful?!
 *
 * {@link Symbol} is be a proxy for enum values specified in the query.
 */
export type GraphQLType = number | string | Symbol | GraphQLType[] | { [key: string]: GraphQLType } | null;


/**
 * Wraps a single resolver and handles GraphQL queries.
 */
export class GraphQLServer {
  #resolver;

  constructor(resolver: (context: ResolverContext) => any) {
    this.#resolver = resolver;
  }

  #buildJSArg(arg: ValueNode, variables: { [key: string]: any } = {}): any {
    switch (arg.kind) {
      case Kind.NULL:
        // This is expressed like an enum but matches literal "null" (lowercase only).
        return null;
      case Kind.VARIABLE:
        return variables[arg.name.value];
      case Kind.OBJECT: {
        return Object.fromEntries(arg.fields.map((field) =>
          [field.name.value, this.#buildJSArg(field.value, variables)]
        ));
      }
      case Kind.LIST:
        return arg.values.map((v) => this.#buildJSArg(v, variables));
      case Kind.ENUM:
        // This is if a string is included without quotes in our query.
        return Symbol(arg.value);
    }

    if ('value' in arg) {
      return arg.value;
    }

    // Should never get here
    throw new Error(`arg unsupported: ${JSON.stringify(arg)}`);
  }

  #buildSelectionSet(node: SelectionSetNode, variables: { [key: string]: any }): SelectionSet {
    const selections: SelectionSet = {};

    for (const sel of node.selections) {
      if (sel.kind !== Kind.FIELD) {
        throw new Error(`Fragments are currently unsupported`);
      }

      const o: SelectionSetInner = {};
      selections[sel.name.value] = o;

      if (sel.selectionSet) {
        o.sub = this.#buildSelectionSet(sel.selectionSet, variables);
      }
      if (sel.arguments?.length) {
        // GraphQL doesn't allow selectinos like "foo()", so having an argument means this is a call.
        const args: { [key: string]: any } = {};
        for (const a of sel.arguments) {
          args[a.name.value] = this.#buildJSArg(a.value, variables);
        }
        o.args = args;
      }
    }

    return selections;
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
    const response = await this.handle(request);
    res.write(JSON.stringify(response));
  };

  handle = async (request: GraphQLRequest): Promise<{ data: any }> => {
    // We don't use this as a tag because... we don't need to. Also, it's normalized and cached by
    // graphql-tag, so don't do that again.
    const parsed = gql(request.query);
    if (parsed.kind !== Kind.DOCUMENT) {
      throw new Error(`Got non-document GraphQL kind: ${parsed.kind}`);
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
      throw new Error(`Could not find definition to run: ${JSON.stringify(operationName)}`);
    }
    operationName = defToRun.name?.value || operationName;

    // Construct variables available to the query based on the top-level query type. Grab either
    // their default values or the user-specified variables.
    const variables: { [key: string]: any } = {};
    for (const variableDefinition of defToRun.variableDefinitions ?? []) {
      const name = variableDefinition.variable.name.value;
      variables[name] = request.variables[name] ?? (variableDefinition.defaultValue ? this.#buildJSArg(variableDefinition.defaultValue) : undefined);
    }

    // Convert our selection to a much more sane JS object.
    const selection = this.#buildSelectionSet(defToRun.selectionSet, variables);

    // Call our resolver. GraphQL is nested: the very top-level query is a type of request no
    // different to any other, despite what other servers might say.
    const data = await this.#resolver({ operationName, selection });
    return { data };
  };

}

