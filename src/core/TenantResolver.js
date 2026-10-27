import { AsyncLocalStorage } from 'node:async_hooks';
import { TenantError } from './errors/TenantError.js';

const instanceTenants = new WeakMap();
const transactionTenants = new WeakMap();

export function tenantConfig(option) {
  if (!option || typeof option !== 'object' || Array.isArray(option)
    || typeof option.attribute !== 'string' || !option.attribute.trim()
    || Object.keys(option).some(key => key !== 'attribute')) {
    throw new TenantError('tenant requires an explicit attribute', { code: 'SEQ_TENANT_CONFIG' });
  }
  return Object.freeze({ attribute: option.attribute });
}

export function modelTenant(model) {
  const option = model.options?.tenant;
  if (option === undefined || option === false) return null;
  const config = option === true ? model.seq?._tenantConfig : tenantConfig(option);
  const definition = config && model.rawAttributes?.[config.attribute];
  if (!definition || model._isVirtualAttribute(definition)) {
    throw new TenantError(`Model "${model.modelName}" requires a persistent tenant attribute`, { code: 'SEQ_TENANT_CONFIG' });
  }
  return config;
}

export function tenantIdentity(value) {
  return value === null || value === undefined ? ['absent'] : [typeof value, value];
}

export class TenantResolver {
  constructor(seq) {
    this.seq = seq;
    this.storage = new AsyncLocalStorage();
  }

  current() {
    const scope = this.storage.getStore();
    return scope ? scope.tenantId : this.seq._getContext?.()?.tenantId;
  }

  run(execute) {
    if (this.storage.getStore()) return execute();
    return this.storage.run({ tenantId: this.seq._getContext?.()?.tenantId }, execute);
  }

  resolve(model) {
    const config = modelTenant(model);
    if (!config) return null;
    const value = this.current();
    if (value === null || value === undefined) {
      throw new TenantError(`Tenant context is required for model "${model.modelName}"`, { code: 'SEQ_TENANT_CONTEXT_MISSING' });
    }
    if (!['string', 'number', 'bigint', 'boolean'].includes(typeof value)
      || (typeof value === 'string' && !value.length)
      || (typeof value === 'number' && !Number.isFinite(value))
      || model.rawAttributes[config.attribute].type.validate?.(value).valid === false) {
      throw new TenantError(`Invalid tenant context for model "${model.modelName}"`, { code: 'SEQ_TENANT_CONTEXT_INVALID' });
    }
    return { attribute: config.attribute, value };
  }

  remember(instance, values) {
    const config = modelTenant(instance.constructor);
    if (!config || instance._isNew) return;
    instanceTenants.set(instance, Object.hasOwn(values, config.attribute) ? values[config.attribute] : this.current());
  }

  assertInstance(instance) {
    const tenant = this.resolve(instance.constructor);
    if (tenant && instanceTenants.has(instance) && instanceTenants.get(instance) !== tenant.value) {
      throw new TenantError('Instance belongs to another tenant context', { code: 'SEQ_TENANT_MISMATCH' });
    }
  }

  bindTransaction(transaction) {
    transactionTenants.set(transaction, tenantIdentity(this.current()));
  }

  assertTransaction(transaction) {
    if (!transaction) return;
    const previous = transactionTenants.get(transaction);
    const current = tenantIdentity(this.current());
    if (previous && (previous[0] !== current[0] || previous[1] !== current[1])) {
      throw new TenantError('Transaction belongs to another tenant context', { code: 'SEQ_TENANT_TRANSACTION_MISMATCH' });
    }
  }
}
