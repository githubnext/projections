import type {InspectorDefinitionList} from '../types.js'
import {isDevServerUrl, record} from './guards.js'

export function assertDefinitionList(value: unknown): asserts value is InspectorDefinitionList {
  if (
    !record(value) ||
    !Array.isArray(value.definitions) ||
    typeof value.ref !== 'string' ||
    (value.commit !== undefined && (typeof value.commit !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value.commit))) ||
    typeof value.executionAuthorized !== 'boolean' ||
    (value.rules !== undefined && (!Array.isArray(value.rules) || value.rules.some(path => typeof path !== 'string'))) ||
    (value.invalid !== undefined &&
      (!Array.isArray(value.invalid) ||
        value.invalid.some(item => !record(item) || typeof item.path !== 'string' || !Array.isArray(item.diagnostics)))) ||
    value.definitions.some(
      definition =>
        !record(definition) ||
        typeof definition.id !== 'string' ||
        (typeof definition.renderer !== 'string' && !record(definition.renderer)) ||
        (typeof definition.extractor !== 'string' && !record(definition.extractor)),
    ) ||
    (value.policies !== undefined &&
      (!Array.isArray(value.policies) ||
        value.policies.some(
          policy =>
            !record(policy) ||
            typeof policy.id !== 'string' ||
            typeof policy.requiresTrust !== 'boolean' ||
            typeof policy.rendererRequiresTrust !== 'boolean' ||
            (policy.rendererDevServer !== undefined && !isDevServerUrl(policy.rendererDevServer)) ||
            (policy.scenarios !== undefined && typeof policy.scenarios !== 'string'),
        )))
  ) {
    throw new Error('The local runner returned an invalid definition list')
  }
}
