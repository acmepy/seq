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
      return { model: item, as: null, attributes: null, where: null, eager: null };
    }
    if (typeof item === 'string') {
      return { model: null, as: item, attributes: null, where: null, eager: null };
    }
    return {
      model: item.model || null,
      as: item.as || null,
      attributes: item.attributes || null,
      where: item.where || null,
      eager: item.eager !== undefined ? item.eager : null,
      required: item.required === true,
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

export function resolveAssociation(model, include) {
  if (!model?.associations || !include?.model) return null;
  if (include.as && model.associations[include.as]) return model.associations[include.as];
  const candidates = [...new Set(Object.values(model.associations))]
    .filter(association => association?.target === include.model);
  return candidates.length === 1 ? candidates[0] : (model.associations[include.model.modelName] || null);
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

  const children = await _selectInChunks(dml, target, fkAttr, parentIds, inc, queryOptions, [fkAttr]);
  const childrenByFK = _groupBy(children, child => child.getDataValue(fkAttr));

  for (const instance of instances) {
    const pkVal = instance.getDataValue(parentPK);
    instance.setDataValue(alias, childrenByFK.get(pkVal) || []);
  }
  _trimProjection(children, inc.attributes);
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

  const children = await _selectInChunks(dml, target, fkAttr, parentIds, inc, queryOptions, [fkAttr]);
  const childByFK = _indexBy(children, child => child.getDataValue(fkAttr));

  for (const instance of instances) {
    const pkVal = instance.getDataValue(parentPK);
    instance.setDataValue(alias, childByFK.get(pkVal) || null);
  }
  _trimProjection(children, inc.attributes);
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

  const targets = await _selectInChunks(dml, target, targetPK, fkValues, inc, queryOptions, [targetPK]);
  const targetByPK = _indexBy(targets, target => target.getDataValue(targetPK));

  for (const instance of instances) {
    const fkVal = instance.getDataValue(fkAttr);
    instance.setDataValue(alias, targetByPK.get(fkVal) || null);
  }
  _trimProjection(targets, inc.attributes);
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

  const targets = await _selectInChunks(dml, target, targetPK, targetIds, inc, queryOptions, [targetPK]);
  const targetByPK = _indexBy(targets, target => target.getDataValue(targetPK));

  for (const instance of instances) {
    const pkVal = instance.getDataValue(sourcePK);
    const relatedRows = junctionRowsBySource.get(pkVal) || [];
    const matching = relatedRows
      .map(row => targetByPK.get(row[otherKeyAttr]))
      .filter(Boolean);
    instance.setDataValue(alias, matching);
  }
  _trimProjection(targets, inc.attributes);
}

function _withRequiredAttributes(attributes, required) {
  if (!Array.isArray(attributes) || attributes.length === 0) return undefined;
  return [...new Set([...attributes, ...required])];
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
      transaction: queryOptions.transaction
    });
  }));
  return rows.flat();
}

function _trimProjection(instances, attributes) {
  if (!Array.isArray(attributes) || attributes.length === 0) return;
  const selected = new Set(attributes);
  for (const instance of instances) {
    for (const key of Object.keys(instance.dataValues)) {
      if (!selected.has(key)) delete instance.dataValues[key];
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
export function processJoinedRows(rows, model, includes, dml) {
  if (rows.length === 0) return [];

  const parentAlias = model.alias;
  const { schema: parentSchema } = dml._schema(model);
  const parentPK = model.primaryKeyAttribute || 'id';
  const parentPKCol = parentPK;

  const includeLookup = new Map();
  for (const inc of includes) {
    if (!inc.model) continue;
    const propertyAlias = resolveIncludeAlias(inc, model);
    const { schema: incSchema, alias: incSqlAlias } = dml._schema(inc.model);
    const sqlAlias = inc.as || incSqlAlias || dml._getTableName(inc.model);
    const assoc = resolveAssociation(model, inc);
    includeLookup.set(sqlAlias, {
      propertyAlias,
      model: inc.model,
      schema: incSchema,
      assoc,
      attributes: inc.attributes,
    });
  }

  const parentMap = new Map();

  for (const row of rows) {
    const parentData = {};
    const childData = new Map();

    for (const [key, value] of Object.entries(row)) {
      const sepIdx = key.indexOf('.');
      if (sepIdx === -1) continue;
      const tblAlias = key.slice(0, sepIdx);
      const colName = key.slice(sepIdx + 1);

      if (tblAlias === parentAlias) {
        parentData[colName] = value;
      } else if (includeLookup.has(tblAlias)) {
        if (!childData.has(tblAlias)) childData.set(tblAlias, {});
        childData.get(tblAlias)[colName] = value;
      }
    }

    const pkVal = parentData[parentPKCol];
    if (!parentMap.has(pkVal)) {
      parentMap.set(pkVal, { parent: parentData, children: new Map() });
    }
    const entry = parentMap.get(pkVal);

    for (const [sqlAlias, rawChild] of childData) {
      if (!entry.children.has(sqlAlias)) entry.children.set(sqlAlias, []);
      const childRows = entry.children.get(sqlAlias);
      const incInfo = includeLookup.get(sqlAlias);
      const childPK = incInfo.model.primaryKeyAttribute || 'id';
      const childPKCol = childPK;

      const allNull = Object.values(rawChild).every(v => v === null);
      if (allNull) continue;

      const childPKVal = rawChild[childPKCol];
      const exists = childRows.some(r => r[childPKCol] === childPKVal);
      if (!exists) childRows.push(rawChild);
    }
  }

  const instances = [];
  for (const [, entry] of parentMap) {
    const attrParent = dml._toAttrNames(entry.parent, parentSchema);
    const instance = new model(attrParent, { _isNew: false });

    for (const [sqlAlias, incInfo] of includeLookup) {
      const rawRows = entry.children.get(sqlAlias) || [];

      if (incInfo.assoc?.type === 'belongsTo') {
        if (rawRows.length > 0) {
          const attrRow = _pickAttributes(dml._toAttrNames(rawRows[0], incInfo.schema), incInfo.attributes);
          instance.setDataValue(incInfo.propertyAlias, new incInfo.model(attrRow, { _isNew: false, _partial: !!incInfo.attributes }));
        } else {
          instance.setDataValue(incInfo.propertyAlias, null);
        }
      } else if (incInfo.assoc?.type === 'hasOne') {
        if (rawRows.length > 0) {
          const attrRow = _pickAttributes(dml._toAttrNames(rawRows[0], incInfo.schema), incInfo.attributes);
          instance.setDataValue(incInfo.propertyAlias, new incInfo.model(attrRow, { _isNew: false, _partial: !!incInfo.attributes }));
        } else {
          instance.setDataValue(incInfo.propertyAlias, null);
        }
      } else {
        const childInstances = rawRows.map(r => {
          const attrRow = _pickAttributes(dml._toAttrNames(r, incInfo.schema), incInfo.attributes);
          return new incInfo.model(attrRow, { _isNew: false, _partial: !!incInfo.attributes });
        });
        instance.setDataValue(incInfo.propertyAlias, childInstances);
      }
    }

    instances.push(instance);
  }

  return instances;
}

function _pickAttributes(values, attributes) {
  if (!Array.isArray(attributes) || attributes.length === 0) return values;
  return Object.fromEntries(attributes.filter(key => key in values).map(key => [key, values[key]]));
}
