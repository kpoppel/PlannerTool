/**
 * ESLint guard rule: no-runtime-state-violations
 *
 * Three checks (all warn-only in Phase 0):
 *  (a) store.setState() called outside application/commands/** — inert until the store exists
 *  (b) bus.emit() with a payload object literal containing known state-shape keys
 *      (features, capacity, scenario, scenarios) — actionable TODAY
 *  (c) Test files (tests/**) accessing an identifier._privateName on an imported symbol
 */

'use strict';

// Keys that indicate a bus.emit payload is carrying whole state slices rather than
// fine-grained event data.  Expand this list as the state shape is formalised.
const STATE_PAYLOAD_KEYS = new Set([
  'features',
  'feature',
  'capacity',
  'capacities',
  'scenario',
  'scenarios',
  'projects',
  'teams',
  'baseline',
  'overrides',
  'teamDailyCapacity',
  'projectDailyCapacity',
  'projectDailyCapacityRaw',
  'totalOrgDailyCapacity',
  'totalOrgDailyPerTeamAvg',
]);
const LIKELY_STATE_PAYLOAD_KEY_RE =
  /(feature|scenario|capacity|teamDaily|projectDaily|totalOrg|baseline|override)/i;

function getPropertyKeyName(prop) {
  if (!prop || prop.type !== 'Property' || !prop.key) return null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'Literal' && typeof prop.key.value === 'string') return prop.key.value;
  return null;
}

function isComplexPayloadValue(node) {
  return (
    node &&
    node.type !== 'Literal' &&
    node.type !== 'TemplateLiteral' &&
    node.type !== 'Identifier'
  );
}

function findVariableInScope(scope, name) {
  let current = scope;
  while (current) {
    const variable = current.variables.find((v) => v.name === name);
    if (variable) return variable;
    current = current.upper;
  }
  return null;
}

function resolveIdentifierToObjectExpression(scope, name) {
  const variable = findVariableInScope(scope, name);
  if (!variable) return null;
  for (const def of variable.defs) {
    if (def.node && def.node.type === 'VariableDeclarator' && def.node.init) {
      if (def.node.init.type === 'ObjectExpression') return def.node.init;
    }
  }
  return null;
}

function findStatePayloadKey(payload, scope) {
  if (!payload) return null;

  if (payload.type === 'ObjectExpression') {
    for (const prop of payload.properties) {
      const key = getPropertyKeyName(prop);
      if (!key) continue;
      if (STATE_PAYLOAD_KEYS.has(key)) return key;
      if (LIKELY_STATE_PAYLOAD_KEY_RE.test(key) && isComplexPayloadValue(prop.value)) {
        return key;
      }
    }
    return null;
  }

  if (payload.type === 'Identifier') {
    const resolved = resolveIdentifierToObjectExpression(scope, payload.name);
    if (resolved) return findStatePayloadKey(resolved, scope);
  }

  if (payload.type === 'ConditionalExpression') {
    return (
      findStatePayloadKey(payload.consequent, scope) ||
      findStatePayloadKey(payload.alternate, scope)
    );
  }

  if (payload.type === 'LogicalExpression') {
    return findStatePayloadKey(payload.right, scope);
  }

  return null;
}

function extractRootIdentifier(node) {
  let current = node;
  while (current && current.type === 'MemberExpression') {
    current = current.object;
  }
  return current && current.type === 'Identifier' ? current.name : null;
}

function isBusEmitterObject(node) {
  if (!node) return false;
  if (node.type === 'Identifier') {
    return /(^|_)(bus|eventBus)$/i.test(node.name);
  }
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    return /(^|_)(bus|eventBus)$/i.test(node.property.name);
  }
  return false;
}

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warn on runtime state violations: store.setState outside commands, ' +
        'bus.emit with state-shape payloads, and private-field access in tests.',
      category: 'Architecture',
    },
    messages: {
      storeSetStateOutsideCommands:
        'store.setState() called outside application/commands/**. ' +
        'Mutations must go through a command.',
      busEmitStatePayload:
        'bus.emit() carries a state-shape key "{{key}}". ' +
        'Emit a fine-grained event instead of broadcasting whole state slices.',
      testPrivateAccess:
        'Test file accesses private field "{{member}}" on "{{object}}". ' +
        'Pin tests to the public API, not internal shape.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.getSourceCode();
    const filename = context.getFilename();
    const isTestFile = /(^|[\\/])tests[\\/]/.test(filename);
    const isCommandsFile = /[\\/]application[\\/]commands[\\/]/.test(filename);
    const importedBindings = new Set();

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          importedBindings.add(specifier.local.name);
        }
      },

      VariableDeclarator(node) {
        if (
          !node.init ||
          node.init.type !== 'CallExpression' ||
          node.init.callee.type !== 'Identifier' ||
          node.init.callee.name !== 'require'
        ) {
          return;
        }
        if (node.id.type === 'Identifier') {
          importedBindings.add(node.id.name);
        } else if (node.id.type === 'ObjectPattern') {
          for (const prop of node.id.properties) {
            if (prop.type === 'Property' && prop.value.type === 'Identifier') {
              importedBindings.add(prop.value.name);
            }
          }
        }
      },

      // (a) store.setState() outside commands
      CallExpression(node) {
        if (
          !isCommandsFile &&
          node.callee.type === 'MemberExpression' &&
          !node.callee.computed &&
          node.callee.property.name === 'setState' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'store'
        ) {
          context.report({ node, messageId: 'storeSetStateOutsideCommands' });
        }

        // (b) bus.emit(event, { features/capacity/scenario/scenarios: ... })
        if (
          isBusEmitterObject(node.callee.object) &&
          node.callee.type === 'MemberExpression' &&
          !node.callee.computed &&
          node.callee.property.name === 'emit' &&
          node.arguments.length >= 2
        ) {
          const payload = node.arguments[1];
          const key = findStatePayloadKey(payload, sourceCode.getScope(node));
          if (key) {
            context.report({ node, messageId: 'busEmitStatePayload', data: { key } });
          }
        }
      },

      // (c) test files: imported._privateMember
      MemberExpression(node) {
        if (!isTestFile) return;
        if (node.computed) return;
        const prop = node.property;
        if (!(prop.type === 'Identifier' && prop.name.startsWith('_'))) return;

        const rootIdentifier = extractRootIdentifier(node.object);
        if (!rootIdentifier || !importedBindings.has(rootIdentifier)) return;

        context.report({
          node,
          messageId: 'testPrivateAccess',
          data: { member: prop.name, object: sourceCode.getText(node.object) },
        });
      },

      'Program:exit'() {
        importedBindings.clear();
      },
    };
  },
};
