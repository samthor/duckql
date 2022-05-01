
import type { GraphQLVariables, SelectionNode, SelectionSet } from '../types';
import type { FieldNode, SelectionSetNode } from 'graphql';
import { Kind } from 'graphql';
import { convertVarToNode, convertNodeToVar } from './values';

// Use structuredClone from Node 17+.
const cloneAst = typeof structuredClone === 'function' ? structuredClone : <T>(x: T): T => JSON.parse(JSON.stringify(x));

/**
 * Helper that constructs {@link SelectionSet} from a {@link FieldNode}.
 */
export class SelectionContext {
  variables;
  maxDepth = 0;

  constructor(variables: GraphQLVariables) {
    this.variables = variables;
  }

  /**
   * Pretend that the passed {@link SelectionSetNode} is a single "blank" field, and descend the
   * tree to interpolate all {@link Kind.VARIABLE} into concrete values.
   *
   * This clones the passed node and returns a virtual {@link FieldNode}.
   */
  build(selectionSet: SelectionSetNode): SelectionNode {
    const virtualFieldNode: FieldNode = {
      kind: Kind.FIELD,
      name: {
        kind: Kind.NAME,
        value: '',
      },
      selectionSet: cloneAst(selectionSet),
    };
    return {
      node: virtualFieldNode,
      sub: this.#internalBuild(virtualFieldNode, 0),
    };
  }

  #internalBuild(node: FieldNode, depth: number): SelectionSet | undefined {
    const selections = node.selectionSet?.selections;
    if (!selections) {
      return;
    }

    ++depth;
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

      const sub = this.#internalBuild(sel, depth);
      if (sub) {
        o.sub = sub;
      }
    }

    return set;
  }
}

