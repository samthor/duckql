
import type { OperationDefinitionNode, FieldNode, OperationTypeNode } from 'graphql';

export interface GraphQLRequest {
  operationName?: string;
  query: string;
  variables?: GraphQLVariables;
}

export type SelectionNode = {
  args?: { [key: string]: GraphQLType },
  directives?: any[],
  sub?: SelectionSet,
  node: FieldNode,
};
export type SelectionSet = { [key: string]: SelectionNode };

export interface ResolverContext {
  operation: OperationTypeNode;
  operationName: string;

  maxDepth: number;

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
