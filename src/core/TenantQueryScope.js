import { Op } from '../operators.js';
import { normalizeInclude } from '../utils/include.js';
import { TenantError } from './errors/TenantError.js';

export function tenantWhere(model, where) {
  const tenant = model.seq?._tenants.resolve(model);
  if (!tenant) return where;
  const condition = { [tenant.attribute]: tenant.value };
  return where == null ? condition : { [Op.and]: [where, condition] };
}

export function tenantQuery(model, options = {}) {
  const result = { ...options, where: tenantWhere(model, options.where) };
  if (options.include) {
    result.include = normalizeInclude(options.include).map(include => {
      if (!include.model) return include;
      const assoc = model.associations?.[include.as]
        || Object.values(model.associations || {}).find(item => item.target === include.model);
      if (assoc?.throughModel) assoc.throughModel.seq?._tenants.resolve(assoc.throughModel);
      return { ...include, ...tenantQuery(include.model, include) };
    });
  }
  return result;
}

export function tenantValues(model, values) {
  const tenant = model.seq?._tenants.resolve(model);
  if (!tenant) return { ...values };
  if (Object.hasOwn(values, tenant.attribute) && values[tenant.attribute] !== tenant.value) {
    throw new TenantError('Tenant attribute must match the current context and cannot be changed', { code: 'SEQ_TENANT_MISMATCH' });
  }
  return { ...values, [tenant.attribute]: tenant.value };
}
