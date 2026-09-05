# Análisis técnico: `seq` ORM

> Revisión de errores, funciones sin uso/duplicadas y problemas de seguridad.

---

## 1. Código muerto / funciones sin uso

### 1.1 `deriveTableName` — nunca se llama

**Archivo:** [`src/utils/naming.js:82`](file:///c:/tmp/seq-orm/seq/src/utils/naming.js#L82-L84)

```js
export function deriveTableName(modelName) {
  return toSnakeCase(modelName) + 's';
}
```

La función está exportada pero **no se importa en ningún archivo** del proyecto (ni en src, tests ni examples). Además el adaptador ya implementa su propia lógica de resolución de nombres en `BaseAdapter.resolveTableName`. Candidata a eliminación.

---

### 1.2 `src/utils/validation.js` — sin uso alguno

**Archivo:** [`src/utils/validation.js`](file:///c:/tmp/seq-orm/seq/src/utils/validation.js)

Las funciones `isEmpty` y `checkAllowNull` están definidas pero **no se importan en ningún lugar** del proyecto. Las validaciones se hacen directamente en `DMLAbstract._validateRecord`. Candidatas a eliminación.

---

### 1.3 `DMLAbstract.selectByPk` — nunca se llama desde fuera de tests

**Archivo:** [`src/adapters/abstract/DMLAbstract.js:768`](file:///c:/tmp/seq-orm/seq/src/adapters/abstract/DMLAbstract.js#L768-L775)

`selectByPk` existe en la capa DML, pero `Model.findByPk` delega a `findOne` → `selectOne`, nunca a `selectByPk`. La función está disponible en la interfaz pública del adaptador pero no tiene consumidores internos.

---

### 1.4 `Model._seq` (getter) — duplicado de `Model.seq`

**Archivo:** [`src/core/Model.js:234`](file:///c:/tmp/seq-orm/seq/src/core/Model.js#L234-L236)

```js
static get _seq() { return this.seq; }
```

El getter `_seq` sólo re-expone `this.seq`. Dentro de la clase se usa `this.seq` directamente en todos los casos. El getter no se llama internamente ni en tests. Puede eliminarse.

---

## 2. Código duplicado

### 2.1 `_trimProjection` — duplicada en `DMLAbstract` y `include.js`

**En DML:** [`src/adapters/abstract/DMLAbstract.js:292-303`](file:///c:/tmp/seq-orm/seq/src/adapters/abstract/DMLAbstract.js#L292-L303)
**En include:** [`src/utils/include.js:352-363`](file:///c:/tmp/seq-orm/seq/src/utils/include.js#L352-L363)

Las dos implementaciones son **funcionalmente idénticas**. El código en `DMLAbstract` usa `this._trimProjection(...)` internamente y la función en `include.js` se llama desde los loaders de includes. Se debería unificar en un solo lugar (probablemente en `include.js`) y que `DMLAbstract` la importe.

---

### 2.2 `_chunks` — duplicada en `DMLAbstract` y `include.js`

**En DML:** [`src/adapters/abstract/DMLAbstract.js:49-53`](file:///c:/tmp/seq-orm/seq/src/adapters/abstract/DMLAbstract.js#L49-L53)
**En include:** [`src/utils/include.js:331-335`](file:///c:/tmp/seq-orm/seq/src/utils/include.js#L331-L335)

Lógica idéntica para partir arrays en chunks de 500. Debería vivir en un solo lugar y ser importada donde se necesite.

---

### 2.3 `_formatDefaultValue` / `_literal` — lógica duplicada

**Base:** [`src/adapters/abstract/DDLAbstract.js:195-205`](file:///c:/tmp/seq-orm/seq/src/adapters/abstract/DDLAbstract.js#L195-L205)
**SQLite:** [`src/adapters/sqlite/SQLiteDDL.js:136-146`](file:///c:/tmp/seq-orm/seq/src/adapters/sqlite/SQLiteDDL.js#L136-L149)

`SQLiteDDL._literal` y `DDLAbstract._formatDefaultValue` implementan la misma lógica de escape de valores SQL por defecto. `SQLiteDDL` sobreescribe `_formatDefaultValue` delegando a `_literal`, pero el código de ambas es prácticamente idéntico. Si `_literal` es el canónico, la función en `DDLAbstract` debería abstraerse a un método heredable.

---

### 2.4 `_associationThroughTable` — duplicada en `DMLAbstract` y `BaseAdapter`

**DML:** [`src/adapters/abstract/DMLAbstract.js:42-47`](file:///c:/tmp/seq-orm/seq/src/adapters/abstract/DMLAbstract.js#L42-L47)
**BaseAdapter:** [`src/adapters/BaseAdapter.js:303-308`](file:///c:/tmp/seq-orm/seq/src/adapters/BaseAdapter.js#L303-L308)

Lógica idéntica para resolver la tabla through de una asociación. Debería estar en un solo lugar.

---

### 2.5 Validaciones `where` repetidas en `Model` y `DMLAbstract`

En `Model.findAll`, `Model.update`, `Model.destroy` se valida `options.where` antes de llamar al adaptador. El adaptador también valida (via `_buildWhere`). La validación de formato podría centralizarse.

---

## 3. Errores lógicos / bugs potenciales

### 3.1 `resolveIncludeAlias` — rama muerta y error de lógica

**Archivo:** [`src/utils/include.js:48-54`](file:///c:/tmp/seq-orm/seq/src/utils/include.js#L48-L54)

```js
export function resolveIncludeAlias(include, model) {
  if (include.as) return include.as;
  const assoc = resolveAssociation(model, include);
  if (assoc?.as) return assoc.as;
  if (include.model?.alias) return include.model.modelName.toLowerCase() + 's'; // ← NO usa alias
  return include.model.modelName.toLowerCase() + 's';
}
```

La rama `if (include.model?.alias)` comprueba `alias` pero retorna el mismo valor que la rama `else` — ignora completamente `include.model.alias`. Probablemente debería retornar `include.model.alias`.

---

### 3.2 `findAndCountAll` — doble normalización del resultado

**Archivo:** [`src/core/Model.js:677`](file:///c:/tmp/seq-orm/seq/src/core/Model.js#L667-L678)

```js
const [count, rows] = await Promise.all([this.count(countOptions), this.findAll(findOptions)]);
return { count, rows: this._normalizeFindResult(rows, options.plain) };
```

`findAll` ya aplica `_normalizeFindResult` internamente. Luego `findAndCountAll` lo aplica de nuevo sobre el resultado de `findAll`. Si `options.plain` es `true`, los objetos se "plainifican" dos veces, lo que no causa un error observable pero es ineficiente y semánticamente incorrecto.

---

### 3.3 `_buildLimitOffset` — `offset` sin `limit` usa `LIMIT -1`

**Archivo:** [`src/adapters/abstract/DMLAbstract.js:252-258`](file:///c:/tmp/seq-orm/seq/src/adapters/abstract/DMLAbstract.js#L252-L258)

```js
} else if (options.offset) {
  return ` LIMIT -1 OFFSET ${options.offset}`;
}
```

`LIMIT -1` es válido en SQLite, pero **no en MySQL ni Oracle**. En MySQL se recomienda un número enorme (`18446744073709551615`), y en Oracle se usa `FETCH FIRST ... ROWS ONLY` con otro mecanismo. Esta rama puede fallar silenciosamente con los adaptadores reales.

---

### 3.4 `DDLAbstract.addColumns` — usa `_db` directamente

**Archivo:** [`src/adapters/abstract/DDLAbstract.js:188`](file:///c:/tmp/seq-orm/seq/src/adapters/abstract/DDLAbstract.js#L188)

```js
this._measureSql(sql, [], () => this._adapter._db.prepare(sql).run());
```

`DDLAbstract` es una clase abstracta, pero accede a `this._adapter._db` directamente — asumiendo que el adaptador es SQLite. Si otro adaptador hereda de `DDLAbstract` sin sobrescribir `addColumns`, falla en tiempo de ejecución con un error críptico.

Lo mismo ocurre en `addUniqueConstraint` (línea 217) y `addForeignKey` (línea 245).

---

### 3.5 `Seq.authenticate` — llama a `init()` implícitamente

**Archivo:** [`src/core/Seq.js:73-77`](file:///c:/tmp/seq-orm/seq/src/core/Seq.js#L73-L77)

```js
async authenticate() {
  const result = ... await this._adapter.authenticate();
  if (!this._initialized) await this.init();
  return result;
}
```

El efecto secundario de inicializar el ORM al autenticar puede ser sorpresivo. Si `authenticate` se llama antes de que todos los modelos estén registrados, `init` se ejecuta con una lista incompleta. No hay documentación que advierta sobre esto.

---

### 3.6 `Model.save` en instancias existentes sin PK definida

**Archivo:** [`src/core/Model.js:884-886`](file:///c:/tmp/seq-orm/seq/src/core/Model.js#L884-L886)

```js
const pk = Ctor.primaryKeyAttribute;
const where = { [pk]: this.dataValues[pk] };
```

Si `pk` es `null` (modelo sin primary key), la clave del objeto `where` es la cadena `"null"`, generando una condición SQL malformada (`WHERE "null" = ?`) en lugar de lanzar un error claro.

---

## 4. Problemas de seguridad

### 4.1 SQL injection en `_buildCondition` — col no está escapado en Op.like

**Archivo:** [`src/adapters/abstract/DMLAbstract.js:142`](file:///c:/tmp/seq-orm/seq/src/adapters/abstract/DMLAbstract.js#L141-L143)

```js
case Op.like:
  return { sql: `${col} LIKE ?`, params: [this._serializeValue(value)] };
```

El parámetro `value` se enlaza correctamente con `?`. **Sin embargo**, `col` se genera a partir del nombre de columna traducido, que a su vez viene de `schema.attrToColumn[key]`. Aunque los nombres de columna son controlados por el schema del modelo (no por el usuario), si un adaptador personalizado almacena nombres con comillas incrustadas podría causar issues. El riesgo es bajo pero el código debería garantizar siempre que `col` sea el resultado de `_colRef` (que sí usa `_quoteIdentifier`). En la práctica, `col` ya viene de `_colRef`, por lo que el riesgo real es mínimo.

---

### 4.2 `_formatLogValue` — strip de caracteres insuficiente

**Archivo:** [`src/core/Seq.js:463`](file:///c:/tmp/seq-orm/seq/src/core/Seq.js#L453-L464)

```js
return output.replace(/[\\\"']/g, '');
```

La función elimina `\`, `"`, `'` del JSON serializado **antes** de loguearlo. Esto puede producir logs con JSON inválido (al quitar las comillas), dificultando el parsing de logs estructurados. Además, la redacción de campos sensibles (`password|token|secret...`) es una buena práctica, pero el strip posterior destruye la estructura JSON que ya era válida.

---

### 4.3 Información de stack trace en errores logueados en producción

**Archivo:** [`src/core/Seq.js:483-491`](file:///c:/tmp/seq-orm/seq/src/core/Seq.js#L483-L491)

```js
function logError(error) {
  return { ..., stack: error?.stack ?? null };
}
```

El `stack` completo se pasa al logger en el evento `sync failed`. En un entorno de producción donde el logger escribe a un sistema externo, esto puede exponer rutas del sistema de archivos y detalles internos de la implementación.

---

### 4.4 `_quoteIdentifier` — protección solo contra null bytes

**Archivo:** [`src/adapters/BaseAdapter.js:94-97`](file:///c:/tmp/seq-orm/seq/src/adapters/BaseAdapter.js#L94-L97)

```js
_quoteIdentifier(name) {
  if (typeof name !== 'string' || name.length === 0 || name.includes('\0')) {
    throw new TypeError('SQL identifiers must be non-empty strings without null bytes');
  }
  return `"${name.replaceAll('"', '""')}"`;
}
```

La función está bien para el estándar SQL. Pero los nombres de columna/tabla que llegan aquí ya pasaron por `resolveColumnName` / `resolveTableName`, donde se aplica `.replace(/[^A-Za-z0-9_$#]+/g, '_')`. La cadena de sanitización es correcta, pero está dividida en dos lugares con lógica diferente. Si alguien pasa a `_quoteIdentifier` un identificador que no pasó por `resolveColumnName` (posible en código de adaptadores externos), solo se protege contra `"` y `\0`.

---

## 5. Otros hallazgos menores

| #   | Archivo                                                                                      | Descripción                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5.1 | [`DDLAbstract.js:263`](file:///c:/tmp/seq-orm/seq/src/adapters/abstract/DDLAbstract.js#L263) | Ternario sin paréntesis en `options.preserveConstraints?[...]:[[],[],[]]` — dificulta lectura y puede enmascarar errores si `preserveConstraints` fuese `undefined`.                                                                       |
| 5.2 | [`Seq.js:439`](file:///c:/tmp/seq-orm/seq/src/core/Seq.js#L439)                              | `_normalizeLogging` retorna `disabled` si `logging` es cualquier valor no reconocido (p.ej. un número), silenciando el logging sin warning.                                                                                                |
| 5.3 | [`Model.js:102`](file:///c:/tmp/seq-orm/seq/src/core/Model.js#L102)                          | Comentario `//this._tableNameExplicit = ...` — código comentado sin contexto de por qué.                                                                                                                                                   |
| 5.4 | Varios DML                                                                                   | Múltiples comentarios `//this._log(...)` desactivados en métodos críticos (`insert`, `update`, `delete`, `selectAll`). Si el logging de queries SQL fue movido a `_measureSql`, los comentarios son ruido; si no, hay ausencia de logging. |
| 5.5 | [`src/core/Seq.js:483`](file:///c:/tmp/seq-orm/seq/src/core/Seq.js#L483)                     | `logError` es una función de módulo privada no exportada. Su nombre no sigue la convención de prefijo `_` del resto del proyecto.                                                                                                          |

---

## Resumen priorizado

| Prioridad       | Hallazgo                                                       |
| --------------- | -------------------------------------------------------------- |
| 🔴 Error lógico | `resolveIncludeAlias` — rama `alias` ignorada (§3.1)           |
| 🔴 Error lógico | `Model.save` sin PK genera where malformado (§3.6)             |
| 🔴 Portabilidad | `LIMIT -1 OFFSET x` falla en MySQL/Oracle (§3.3)               |
| 🟠 Diseño       | `DDLAbstract` accede a `_adapter._db` — rompe contratos (§3.4) |
| 🟠 Duplicado    | `_trimProjection` duplicada (§2.1)                             |
| 🟠 Duplicado    | `_chunks` duplicada (§2.2)                                     |
| 🟠 Duplicado    | `_associationThroughTable` duplicada (§2.4)                    |
| 🟡 Sin uso      | `deriveTableName`, `validation.js` completo (§1.1–1.2)         |
| 🟡 Sin uso      | `Model._seq` getter redundante (§1.4)                          |
| 🟡 Seguridad    | Stack trace expuesto en logs de producción (§4.3)              |
| 🟡 Lógica       | Doble normalización en `findAndCountAll` (§3.2)                |
