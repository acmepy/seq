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
  const assoc = model.associations?.[include.model?.modelName];
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
export async function loadIncludes(instances, includes, model, dml) {
  for (const inc of includes) {
    if (!inc.model) continue;

    const assoc = model.associations?.[inc.model.modelName];
    const alias = resolveIncludeAlias(inc, model);

    if (!assoc) {
      for (const instance of instances) {
        instance.setDataValue(alias, []);
      }
      continue;
    }

    switch (assoc.type) {
      case 'hasMany':
        await _loadHasMany(instances, inc, assoc, alias, dml);
        break;
      case 'hasOne':
        await _loadHasOne(instances, inc, assoc, alias, dml);
        break;
      case 'belongsTo':
        await _loadBelongsTo(instances, inc, assoc, alias, dml);
        break;
      case 'belongsToMany':
        await _loadBelongsToMany(instances, inc, assoc, alias, dml);
        break;
      default:
        for (const instance of instances) {
          instance.setDataValue(alias, null);
        }
    }
  }
}

async function _loadHasMany(instances, inc, assoc, alias, dml) {
  const target = assoc.target;
  const fkAttr = assoc.foreignKey;
  const parentPK = assoc.source.primaryKeyAttribute || 'id';

  const parentIds = instances
    .map(i => i.getDataValue(parentPK))
    .filter(id => id !== null && id !== undefined);

  if (parentIds.length === 0) {
    for (const instance of instances) {
      instance.setDataValue(alias, []);
    }
    return;
  }

  const where = { [fkAttr]: { [Op.in]: parentIds }, ...inc.where };
  const children = await dml.selectAll(target, { where });

  for (const instance of instances) {
    const pkVal = instance.getDataValue(parentPK);
    const matching = children.filter(
      c => c.getDataValue(fkAttr) === pkVal
    );
    instance.setDataValue(alias, matching);
  }
}

async function _loadHasOne(instances, inc, assoc, alias, dml) {
  const target = assoc.target;
  const fkAttr = assoc.foreignKey;
  const parentPK = assoc.source.primaryKeyAttribute || 'id';

  const parentIds = instances
    .map(i => i.getDataValue(parentPK))
    .filter(id => id !== null && id !== undefined);

  if (parentIds.length === 0) {
    for (const instance of instances) {
      instance.setDataValue(alias, null);
    }
    return;
  }

  const where = { [fkAttr]: { [Op.in]: parentIds }, ...inc.where };
  const children = await dml.selectAll(target, { where });

  for (const instance of instances) {
    const pkVal = instance.getDataValue(parentPK);
    const match = children.find(c => c.getDataValue(fkAttr) === pkVal);
    instance.setDataValue(alias, match || null);
  }
}

async function _loadBelongsTo(instances, inc, assoc, alias, dml) {
  const target = assoc.target;
  const fkAttr = assoc.foreignKey;
  const targetPK = target.primaryKeyAttribute || 'id';

  const fkValues = instances
    .map(i => i.getDataValue(fkAttr))
    .filter(id => id !== null && id !== undefined);

  if (fkValues.length === 0) {
    for (const instance of instances) {
      instance.setDataValue(alias, null);
    }
    return;
  }

  const where = { [targetPK]: { [Op.in]: fkValues }, ...inc.where };
  const targets = await dml.selectAll(target, { where });

  for (const instance of instances) {
    const fkVal = instance.getDataValue(fkAttr);
    const match = targets.find(t => t.getDataValue(targetPK) === fkVal);
    instance.setDataValue(alias, match || null);
  }
}

async function _loadBelongsToMany(instances, inc, assoc, alias, dml) {
  const target = assoc.target;
  const sourcePK = assoc.source.primaryKeyAttribute || 'id';
  const targetPK = target.primaryKeyAttribute || 'id';
  const fkAttr = assoc.foreignKey;
  const otherKeyAttr = assoc.otherKey;
  const through = assoc.through;

  const sourceIds = instances
    .map(i => i.getDataValue(sourcePK))
    .filter(id => id !== null && id !== undefined);

  if (sourceIds.length === 0) {
    for (const instance of instances) {
      instance.setDataValue(alias, []);
    }
    return;
  }

  const q = (name) => dml._adapter._quoteIdentifier(name);
  const placeholders = sourceIds.map(() => '?').join(', ');
  const junctionSQL = `SELECT ${q(fkAttr)}, ${q(otherKeyAttr)} FROM ${q(through)} WHERE ${q(fkAttr)} IN (${placeholders})`;
  const serializedParams = sourceIds.map(id => dml._serializeValue(id));
  const junctionRows = await dml._executeQueryAll(junctionSQL, serializedParams);

  const targetIds = [...new Set(junctionRows.map(r => r[otherKeyAttr]).filter(id => id !== null && id !== undefined))];

  if (targetIds.length === 0) {
    for (const instance of instances) {
      instance.setDataValue(alias, []);
    }
    return;
  }

  const targetWhere = { [targetPK]: { [Op.in]: targetIds }, ...inc.where };
  const targets = await dml.selectAll(target, { where: targetWhere });

  for (const instance of instances) {
    const pkVal = instance.getDataValue(sourcePK);
    const relatedTargetIds = junctionRows
      .filter(r => r[fkAttr] === pkVal)
      .map(r => r[otherKeyAttr]);
    const matching = targets.filter(t => relatedTargetIds.includes(t.getDataValue(targetPK)));
    instance.setDataValue(alias, matching);
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
  const parentPKCol = parentSchema.attrToColumn[parentPK] || parentPK;

  const includeLookup = new Map();
  for (const inc of includes) {
    if (!inc.model) continue;
    const propertyAlias = resolveIncludeAlias(inc, model);
    const { schema: incSchema, alias: incSqlAlias } = dml._schema(inc.model);
    const sqlAlias = incSqlAlias || dml._getTableName(inc.model);
    const assoc = model.associations?.[inc.model.modelName];
    includeLookup.set(sqlAlias, {
      propertyAlias,
      model: inc.model,
      schema: incSchema,
      assoc,
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
      const childPKCol = incInfo.schema.attrToColumn[childPK] || childPK;

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
          const attrRow = dml._toAttrNames(rawRows[0], incInfo.schema);
          instance.setDataValue(incInfo.propertyAlias, new incInfo.model(attrRow, { _isNew: false }));
        } else {
          instance.setDataValue(incInfo.propertyAlias, null);
        }
      } else if (incInfo.assoc?.type === 'hasOne') {
        if (rawRows.length > 0) {
          const attrRow = dml._toAttrNames(rawRows[0], incInfo.schema);
          instance.setDataValue(incInfo.propertyAlias, new incInfo.model(attrRow, { _isNew: false }));
        } else {
          instance.setDataValue(incInfo.propertyAlias, null);
        }
      } else {
        const childInstances = rawRows.map(r => {
          const attrRow = dml._toAttrNames(r, incInfo.schema);
          return new incInfo.model(attrRow, { _isNew: false });
        });
        instance.setDataValue(incInfo.propertyAlias, childInstances);
      }
    }

    instances.push(instance);
  }

  return instances;
}
