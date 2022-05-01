
/**
 * @fileoverview Handles incoming GraphQL queries (nd passes to a single queryresolver.
 */

import { parse, Kind, DocumentNode } from 'graphql';
import type * as http from 'http';
import { ParseCache } from './lib/parse-cache';
import { SelectionContext } from './lib/selection';
import { convertNodeToVar } from './lib/values';
import type { GraphQLRequest, GraphQLVariables, ResolverContext } from './types';

export const DEFAULT_MAX_QUERY_LENGTH = 2_000;

export type ResponseType = { data?: any };

export interface DuckQLServerOptions {
  resolver: (context: ResolverContext) => Promise<ResponseType | undefined> | ResponseType | undefined;
  parseCache?: ParseCache;
  maxQueryLength?: number;
}

/**
 * Wraps a single resolver and handles GraphQL queries.
 */
export class DuckQLServer {
  #resolver;
  #parseCache;
  #maxQueryLength;
  parse;

  constructor(options: DuckQLServerOptions) {
    this.#resolver = options.resolver;
    this.#parseCache = options.parseCache ?? new ParseCache();
    this.#maxQueryLength = options.maxQueryLength ?? DEFAULT_MAX_QUERY_LENGTH;

    this.parse = (query: string): DocumentNode => {
      if (query.length > this.#maxQueryLength) {
        throw new GraphQLQueryError(`Query is too long, cowardly refusing to parse`);
      }
      return this.#parseCache.parse(query);
    }
  }

  /**
   * Provides a HTTP server which responds to "/graphql".
   */
  httpHandle = async (req: http.IncomingMessage, res: http.ServerResponse, next?: () => any) => {
    if (req.url !== '/graphql') {
      if (next) {
        await next();
      } else {
        res.statusCode = 404;
      }
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
    res.setHeader('Content-Type', 'application/json');
    res.write(JSON.stringify(response));
  };

  /**
   * Parses a {@link GraphQLRequest} and passes to this instance's resolver.
   */
  handle = (request: GraphQLRequest): Promise<ResponseType> | ResponseType => {
    const context = buildContext(request, this.parse);

    const out = this.#resolver(context);
    if (out instanceof Promise) {
      return out.then((raw) => raw ?? {});
    }
    return out ?? {};
  };

}


export function buildContext(
  request: GraphQLRequest,
  graphqlParse: (q: string) => DocumentNode = parse,
): ResolverContext {
  let parsed;
  try {
    parsed = graphqlParse(request.query);
  } catch (e) {
    if (!(e instanceof GraphQLQueryError) && e instanceof Error) {
      // This is a parse error, which is kind of the user's fault.
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

  // Construct variables available to the query based on the top-level query type. Grab either
  // the user-specified variable or their default value.
  const variables: GraphQLVariables = {};
  for (const variableDefinition of defToRun.variableDefinitions ?? []) {
    const name = variableDefinition.variable.name.value;

    if (request.variables?.[name] !== undefined) {
      variables[name] = request.variables[name];
    } else if (variableDefinition.defaultValue) {
      variables[name] = convertNodeToVar(variableDefinition.defaultValue, {});
    }
  }

  const c = new SelectionContext(variables);
  const selection = c.build(defToRun.selectionSet);

  // Generate a friendly context to pass around.
  return {
    operation: defToRun.operation,
    operationName,
    maxDepth: c.maxDepth,
    selection,
    node: defToRun,
  };
}


export class GraphQLQueryError extends Error { }

