
import type { GraphQLVariables, SelectionNode, SelectionSet } from '../types';
import type { FieldNode } from 'graphql';
import { Kind } from 'graphql';
import { convertVarToNode, convertNodeToVar } from './values';

/**
 * Helper that constructs {@link SelectionSet} from a {@link FieldNode}.
 */
export class SetContext {
  variables;
  maxDepth = 0;

  constructor(variables: GraphQLVariables) {
    this.variables = variables;
  }

  /**
   * Enumerate through all requested fields and interpolate {@link Kind.VARIABLE} into nodes.
   *
   * This must be called with a cloned AST, as it is modified in-place.
   */
  build(node: FieldNode, depth: number = 0): SelectionSet | undefined {
    const selections = node.selectionSet?.selections;
    if (!selections) {
      return;
    }

    this.maxDepth = Math.max(depth, this.maxDepth);

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
          const jsArg = convertNodeToVar(arg.value, this.variables);
          args[arg.name.value] = jsArg;

          // Convert this back again in case it contains VARIABLE, for the caller's easy ability to
          // forward the request onwards.
          const node = convertVarToNode(jsArg);

          // @ts-ignore We've cloned before starting
          arg.value = node;
        }
        o.args = args;
      }

      const sub = this.build(sel, depth + 1);
      if (sub) {
        o.sub = sub;
      }
    }

    return set;
  }
}

