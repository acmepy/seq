import { Op } from '../operators.js';

/**
 * Normalizes the include option to an array of include descriptors.
 * @param {string|typeof import('../core/Model.js').Model|object|Array} include
 * @returns {object[]}
 */
export function normalizeInclude(include) {
  const arr = Array.isArray(include) ? include : [include];
  return arr.map(item => {
    if (typeof item === 'function') {
      return { model: item, as: null, attributes: null, where: null, eager: null, include: [] };
    }
    if (typeof item === 'string') {
      return { model: null, as: item, attributes: null, where: null, eager: null, include: [] };
    }
    return {
      model: item.model || null,
      as: item.as || null,
      attributes: item.attributes || null,
      where: item.where || null,
      eager: item.eager !== undefined ? item.eager : null,
      required: item.required === true,
      include: item.include ? normalizeInclude(item.include) : [],
    };
  });
}

/**
 * Resolves the effective eager flag for an include.
 * Priority: include.eager > globalEager > false
 * @param {object} include
 * @param {boolean} [globalEager=false]
 * @returns {boolean}
 */
export function resolveEager(include, globalEager = false) {
  if (include.eager !== null && include.eager !== undefined) return include.eager;
  return globalEager;
}

/**
 * Resolves the alias for an include descriptor.
 * Priority: include.as > association.as > targetModel.alias > auto-generated
 * @param {object} include
 * @param {typeof import('../core/Model.js').Model} model
 * @returns {string}
 */
export function resolveIncludeAlias(include, model) {
  if (include.as) return include.as;
  const assoc = resolveAssociation(model, include);
  if (assoc?.as) return assoc.as;
  if (include.model?.alias) return include.model.modelName.toLowerCase() + 's';
  return include.model.modelName.toLowerCase() + 's';
}

export function buildIncludeSqlAliasMap(includes, model, dml, globalEager = false) {
  const used = new Set();
  const parentAlias = model.alias || dml._getTableName(model);
  if (parentAlias) used.add(parentAlias);

  const aliases = new Map();
  _addIncludeSqlAliases(includes, aliases, used, dml, globalEager);
  return aliases;
}

function _addIncludeSqlAliases(includes, aliases, used, dml, globalEager) {
  for (const inc of includes || []) {
    if (!inc.model) continue;
    const { tableName, alias: targetAlias } = dml._schema(inc.model);
    const preferredAlias = targetAlias || inc.model.alias || tableName;
    const sqlAlias = _uniqueAlias(preferredAlias, used, inc.as || tableName);
    aliases.set(inc, sqlAlias);
    _addIncludeSqlAliases(eagerNestedIncludes(inc, globalEager), aliases, used, dml, globalEager);
  }
}

/**
 * Loads eager-loading includes onto an array of model instances.
 * Uses separate queries with WHERE IN for efficiency.
 * @param {import('../core/Model.js').Model[]} instances
 * @param {object[]} includes
 * @param {typeof import('../core/Model.js').Model} model
 * @param {import('../adapters/abstract/DMLAbstract.js').DMLAbstract} dml
 * @returns {Promise<void>}
 */
export async function loadIncludes(instances, includes, model, dml, queryOptions = {}) {
  await Promise.all(includes.map(async inc => {
    if (!inc.model) return;

    const assoc = resolveAssociation(model, inc);
    const alias = resolveIncludeAlias(inc, model);

    if (!assoc) {
      for (const instance of instances) {
        instance.setDataValue(alias, []);
      }
      return;
    }

    switch (assoc.type) {
      case 'hasMany':
        await _loadHasMany(instances, inc, assoc, alias, dml, queryOptions);
        break;
      case 'hasOne':
        await _loadHasOne(instances, inc, assoc, alias, dml, queryOptions);
        break;
      case 'belongsTo':
        await _loadBelongsTo(instances, inc, assoc, alias, dml, queryOptions);
        break;
      case 'belongsToMany':
        await _loadBelongsToMany(instances, inc, assoc, alias, dml, queryOptions);
        break;
      default:
        for (const instance of instances) {
          instance.setDataValue(alias, null);
        }
    }
  }));
  return instances.filter(instance => includes.every(inc => {
    if (!inc.required || !inc.model) return true;
    const value = instance.getDataValue(resolveIncludeAlias(inc, model));
    return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined;
  }));
}

export async function loadNestedLazyIncludes(instances, includes, model, dml, queryOptions = {}) {
  const globalEager = queryOptions.eager ?? dml._adapter.eager ?? false;
  for (const inc of includes || []) {
    if (!inc.model || !inc.include?.length) continue;
    let children = _attachedInstances(instances, inc, model);
    if (children.length === 0) continue;

    const lazyIncludes = lazyNestedIncludes(inc, globalEager);
    if (lazyIncludes.length > 0) {
      children = await loadIncludes(children, lazyIncludes, inc.model, dml, queryOptions);
      _retainAttachedInstances(instances, inc, model, children);
    }

    const eagerIncludes = eagerNestedIncludes(inc, globalEager);
    if (eagerIncludes.length > 0) {
      children = await loadNestedLazyIncludes(children, eagerIncludes, inc.model, dml, queryOptions);
      _retainAttachedInstances(instances, inc, model, children);
    }
  }
  return instances;
}

export function eagerNestedIncludes(include, globalEager = false) {
  return (include.include || []).filter(inc => resolveEager(inc, globalEager));
}

export function lazyNestedIncludes(include, globalEager = false) {
  return (include.include || []).filter(inc => !resolveEager(inc, globalEager));
}

export function resolveAssociation(model, include) {
  if (!model?.associations || !include?.model) return null;
  if (include.as && model.associations[include.as]) return model.associations[include.as];
  const candidates = [...new Set(Object.values(model.associations))]
    .filter(association => association?.target === include.model);
  return candidates.length === 1 ? candidates[0] : (model.associations[include.model.modelName] || null);
}

function _uniqueAlias(preferred, used, fallback) {
  const base = preferred || fallback;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  if (fallback && fallback !== base && !used.has(fallback)) {
    used.add(fallback);
    return fallback;
  }
  let index = 2;
  let alias = `${base}_${index}`;
  while (used.has(alias)) {
    index += 1;
    alias = `${base}_${index}`;
  }
  used.add(alias);
  return alias;
}

function _definedValues(items, getValue) {
  return [...new Set(
    items
      .map(getValue)
      .filter(value => value !== null && value !== undefined)
  )];
}

function _groupBy(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (key === null || key === undefined) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function _indexBy(items, getKey) {
  const index = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (key !== null && key !== undefined && !index.has(key)) {
      index.set(key, item);
    }
  }
  return index;
}

async function _loadHasMany(instances, inc, assoc, alias, dml, queryOptions) {
  const target = assoc.target;
  const fkAttr = assoc.foreignKey;
  const parentPK = assoc.source.primaryKeyAttribute || 'id';

  const parentIds = _definedValues(instances, i => i.getDataValue(parentPK));

  if (parentIds.length === 0) {
    for (const instance of instances) {
      instance.setDataValue(alias, []);
    }
    return;
  }

  const children = await _selectInChunks(dml, target, fkAttr, parentIds, inc, queryOptions, _requiredAttributes(inc, target, [fkAttr]));
  const childrenByFK = _groupBy(children, child => child.getDataValue(fkAttr));

  for (const instance of instances) {
    const pkVal = instance.getDataValue(parentPK);
    instance.setDataValue(alias, childrenByFK.get(pkVal) || []);
  }
  _trimProjection(children, inc.attributes, inc.include, target);
}

async function _loadHasOne(instances, inc, assoc, alias, dml, queryOptions) {
  const target = assoc.target;
  const fkAttr = assoc.foreignKey;
  const parentPK = assoc.source.primaryKeyAttribute || 'id';

  const parentIds = _definedValues(instances, i => i.getDataValue(parentPK));

  if (parentIds.length === 0) {
    for (const instance of instances) {
      instance.setDataValue(alias, null);
    }
    return;
  }

  const children = await _selectInChunks(dml, target, fkAttr, parentIds, inc, queryOptions, _requiredAttributes(inc, target, [fkAttr]));
  const childByFK = _indexBy(children, child => child.getDataValue(fkAttr));

  for (const instance of instances) {
    const pkVal = instance.getDataValue(parentPK);
    instance.setDataValue(alias, childByFK.get(pkVal) || null);
  }
  _trimProjection(children, inc.attributes, inc.include, target);
}

async function _loadBelongsTo(instances, inc, assoc, alias, dml, queryOptions) {
  const target = assoc.target;
  const fkAttr = assoc.foreignKey;
  const targetPK = target.primaryKeyAttribute || 'id';

  const fkValues = _definedValues(instances, i => i.getDataValue(fkAttr));

  if (fkValues.length === 0) {
    for (const instance of instances) {
      instance.setDataValue(alias, null);
    }
    return;
  }

  const targets = await _selectInChunks(dml, target, targetPK, fkValues, inc, queryOptions, _requiredAttributes(inc, target, [targetPK]));
  const targetByPK = _indexBy(targets, target => target.getDataValue(targetPK));

  for (const instance of instances) {
    const fkVal = instance.getDataValue(fkAttr);
    instance.setDataValue(alias, targetByPK.get(fkVal) || null);
  }
  _trimProjection(targets, inc.attributes, inc.include, target);
}

async function _loadBelongsToMany(instances, inc, assoc, alias, dml, queryOptions) {
  const target = assoc.target;
  const sourcePK = assoc.source.primaryKeyAttribute || 'id';
  const targetPK = target.primaryKeyAttribute || 'id';
  const fkAttr = assoc.foreignKey;
  const otherKeyAttr = assoc.otherKey;
  const through = dml._associationThroughTable
    ? dml._associationThroughTable(assoc)
    : (assoc.throughTable || assoc.through);
  const throughSchema = dml._adapter.schemas.get(through);
  const fkCol = throughSchema?.attrToColumn?.[fkAttr] || fkAttr;
  const otherKeyCol = throughSchema?.attrToColumn?.[otherKeyAttr] || otherKeyAttr;

  const sourceIds = _definedValues(instances, i => i.getDataValue(sourcePK));

  if (sourceIds.length === 0) {
    for (const instance of instances) {
      instance.setDataValue(alias, []);
    }
    return;
  }

  const q = (name) => dml._adapter._quoteIdentifier(name);
  const junctionRows = (await Promise.all(_chunks(sourceIds).map(async ids => {
    const placeholders = ids.map(() => '?').join(', ');
    const junctionSQL = `SELECT ${q(fkCol)} AS ${q(fkAttr)}, ${q(otherKeyCol)} AS ${q(otherKeyAttr)} FROM ${q(through)} WHERE ${q(fkCol)} IN (${placeholders})`;
    return dml._executeQueryAll(junctionSQL, ids.map(id => dml._serializeValue(id)));
  }))).flat();
  const junctionRowsBySource = _groupBy(junctionRows, row => row[fkAttr]);

  const targetIds = [...new Set(junctionRows.map(r => r[otherKeyAttr]).filter(id => id !== null && id !== undefined))];

  if (targetIds.length === 0) {
    for (const instance of instances) {
      instance.setDataValue(alias, []);
    }
    return;
  }

  const targets = await _selectInChunks(dml, target, targetPK, targetIds, inc, queryOptions, _requiredAttributes(inc, target, [targetPK]));
  const targetByPK = _indexBy(targets, target => target.getDataValue(targetPK));

  for (const instance of instances) {
    const pkVal = instance.getDataValue(sourcePK);
    const relatedRows = junctionRowsBySource.get(pkVal) || [];
    const matching = relatedRows
      .map(row => targetByPK.get(row[otherKeyAttr]))
      .filter(Boolean);
    instance.setDataValue(alias, matching);
  }
  _trimProjection(targets, inc.attributes, inc.include, target);
}

function _withRequiredAttributes(attributes, required) {
  if (!Array.isArray(attributes) || attributes.length === 0) return undefined;
  return [...new Set([...attributes, ...required])];
}

function _requiredAttributes(include, model, attributes) {
  if (!include.include?.length) return attributes;
  return [...new Set([...attributes, model.primaryKeyAttribute || 'id'])];
}

function _chunks(values, size = 500) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function _selectInChunks(dml, model, field, values, inc, queryOptions, requiredAttributes) {
  const rows = await Promise.all(_chunks(values).map(ids => {
    const relationWhere = { [field]: { [Op.in]: ids } };
    const where = inc.where ? { [Op.and]: [relationWhere, inc.where] } : relationWhere;
    return dml.selectAll(model, {
      where,
      attributes: _withRequiredAttributes(inc.attributes, requiredAttributes),
      include: inc.include || [],
      eager: queryOptions.eager,
      transaction: queryOptions.transaction
    });
  }));
  return rows.flat();
}

function _trimProjection(instances, attributes, includes = [], model = null) {
  if (!Array.isArray(attributes) || attributes.length === 0) return;
  const selected = new Set(attributes);
  for (const include of includes || []) {
    if (include.model && model) selected.add(resolveIncludeAlias(include, model));
  }
  for (const instance of instances) {
    for (const key of Object.keys(instance.dataValues)) {
      if (!selected.has(key)) delete instance.dataValues[key];
    }
  }
}

function _attachedInstances(instances, inc, model) {
  const alias = resolveIncludeAlias(inc, model);
  const attached = [];
  for (const instance of instances) {
    const value = instance.getDataValue(alias);
    if (Array.isArray(value)) attached.push(...value);
    else if (value) attached.push(value);
  }
  return attached;
}

function _retainAttachedInstances(instances, inc, model, retained) {
  const retainedSet = new Set(retained);
  const alias = resolveIncludeAlias(inc, model);
  for (const instance of instances) {
    const value = instance.getDataValue(alias);
    if (Array.isArray(value)) {
      instance.setDataValue(alias, value.filter(child => retainedSet.has(child)));
    } else if (value && !retainedSet.has(value)) {
      instance.setDataValue(alias, null);
    }
  }
}

/**
 * Processes rows from a JOIN query into model instances with nested includes.
 * Columns are in "alias__column" format.
 * @param {object[]} rows
 * @param {typeof import('../core/Model.js').Model} model
 * @param {object[]} includes - Eager include descriptors
 * @param {import('../adapters/abstract/DMLAbstract.js').DMLAbstract} dml
 * @returns {import('../core/Model.js').Model[]}
 */
export function processJoinedRows(rows, model, includes, dml, includeSqlAliases = buildIncludeSqlAliasMap(includes, model, dml), globalEager = false) {
  if (rows.length === 0) return [];

  const parentAlias = model.alias;
  const { schema: parentSchema } = dml._schema(model);
  const parentPK = model.primaryKeyAttribute || 'id';
  const parentPKCol = parentPK;
  const includeNodes = _buildIncludeNodes(includes, model, dml, includeSqlAliases, globalEager);
  const nodesByAlias = _indexNodesBySqlAlias(includeNodes);

  const parentMap = new Map();

  for (const row of rows) {
    const parentData = {};
    const aliasData = new Map();

    for (const [key, value] of Object.entries(row)) {
      const sepIdx = key.indexOf('.');
      if (sepIdx === -1) continue;
      const tblAlias = key.slice(0, sepIdx);
      const colName = key.slice(sepIdx + 1);

      if (tblAlias === parentAlias) {
        parentData[colName] = value;
      } else if (nodesByAlias.has(tblAlias)) {
        if (!aliasData.has(tblAlias)) aliasData.set(tblAlias, {});
        aliasData.get(tblAlias)[colName] = value;
      }
    }

    const pkVal = parentData[parentPKCol];
    if (!parentMap.has(pkVal)) {
      parentMap.set(pkVal, { raw: parentData, children: new Map() });
    }
    const entry = parentMap.get(pkVal);
    for (const node of includeNodes) _addJoinedNode(entry, node, aliasData);
  }

  const instances = [];
  for (const [, entry] of parentMap) {
    const attrParent = dml._toAttrNames(entry.raw, parentSchema);
    const instance = new model(attrParent, { _isNew: false });
    _attachJoinedIncludes(instance, entry, includeNodes, dml);
    instances.push(instance);
  }

  return instances;
}

function _buildIncludeNodes(includes, parentModel, dml, includeSqlAliases, globalEager) {
  return (includes || []).filter(inc => inc.model).map(inc => {
    const { schema, alias: sqlAlias } = dml._schema(inc.model);
    return {
      inc,
      model: inc.model,
      schema,
      sqlAlias: includeSqlAliases.get(inc) || sqlAlias || dml._getTableName(inc.model),
      propertyAlias: resolveIncludeAlias(inc, parentModel),
      assoc: resolveAssociation(parentModel, inc),
      attributes: inc.attributes,
      children: _buildIncludeNodes(eagerNestedIncludes(inc, globalEager), inc.model, dml, includeSqlAliases, globalEager),
    };
  });
}

function _indexNodesBySqlAlias(nodes, index = new Map()) {
  for (const node of nodes) {
    index.set(node.sqlAlias, node);
    _indexNodesBySqlAlias(node.children, index);
  }
  return index;
}

function _addJoinedNode(parentEntry, node, aliasData) {
  const raw = aliasData.get(node.sqlAlias);
  if (!raw || Object.values(raw).every(value => value === null)) return;

  const pkAttr = node.model.primaryKeyAttribute || 'id';
  const pkValue = raw[pkAttr];
  if (!parentEntry.children.has(node)) parentEntry.children.set(node, new Map());
  const childMap = parentEntry.children.get(node);
  if (!childMap.has(pkValue)) childMap.set(pkValue, { raw, children: new Map() });
  const childEntry = childMap.get(pkValue);

  for (const childNode of node.children) _addJoinedNode(childEntry, childNode, aliasData);
}

function _attachJoinedIncludes(instance, entry, nodes, dml) {
  for (const node of nodes) {
    const childEntries = [...(entry.children.get(node)?.values() || [])];
    if (node.assoc?.type === 'belongsTo' || node.assoc?.type === 'hasOne') {
      const childInstance = childEntries.length > 0 ? _joinedInstance(childEntries[0], node, dml) : null;
      instance.setDataValue(node.propertyAlias, childInstance);
    } else {
      instance.setDataValue(node.propertyAlias, childEntries.map(childEntry => _joinedInstance(childEntry, node, dml)));
    }
  }
}

function _joinedInstance(entry, node, dml) {
  const attrRow = _pickAttributes(dml._toAttrNames(entry.raw, node.schema), node.attributes);
  const instance = new node.model(attrRow, { _isNew: false, _partial: !!node.attributes });
  _attachJoinedIncludes(instance, entry, node.children, dml);
  return instance;
}

function _pickAttributes(values, attributes) {
  if (!Array.isArray(attributes) || attributes.length === 0) return values;
  return Object.fromEntries(attributes.filter(key => key in values).map(key => [key, values[key]]));
}
