
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
   * Builds HTTP middleware that intercepts requests to (by default) "/graphql".
   */
  buildMiddleware(url = '/graphql') {
    return (req: http.IncomingMessage, res: http.ServerResponse, next = () => {}) => {
      if (req.url !== url) {
        if (next) {
          return next();
        }
        res.statusCode = 404;
        return res.end();
      }
      this.httpHandle(req, res);
    };
  }

  /**
   * Provides a HTTP handler that accepts POST graphql requests.
   */
  httpHandle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
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
        res.write('Invalid JSON');
        return;
      }

      const manyRequests = Array.isArray(json);
      const queries: any[] = manyRequests ? json : [json];

      const resultPromises = queries.map((req) => {
        if (!req.query || typeof req.query !== 'string') {
          throw new GraphQLQueryError(`Expected string query, was: ${JSON.stringify(req.query)}`);
        }

        const request: GraphQLRequest = {
          operationName: req.operationName || '',
          query: req.query || '',
          variables: req.variables || {},
        };

        return this.handle(request);
      });

      let results;
      try {
        results = await resultPromises;
      } catch (e) {
        if (e instanceof GraphQLQueryError) {
          res.statusCode = 400;
          res.write(e.message);
          return;
        }
        throw e;
      }
      res.setHeader('Content-Type', 'application/json');
      res.write(JSON.stringify(manyRequests ? results : results[0]));
    } catch (e) {
      console.debug('DuckQLServer internal error', e);
      res.statusCode = 500;
    } finally {
      res.end();
    }
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
    selection: selection,
    node: defToRun,
  };
}


export class GraphQLQueryError extends Error { }

