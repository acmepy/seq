# seq

ORM minimalista y modular inspirado en Sequelize, diseñado inicialmente para Oracle.

El nombre `seq` hace referencia a las secuencias de Oracle. En esta primera etapa, seq funciona completamente en memoria usando colecciones Map.

## Instalación

```bash
npm install
```

## Inicio Rápido

```js
import { Seq, Model, DataTypes, MapAdapter } from './src/index.js';

class User extends Model {
  static define(seq) {
    return this.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        name: {
          type: DataTypes.STRING(100),
          allowNull: false
        },
        email: {
          type: DataTypes.STRING(150),
          allowNull: false,
          unique: true
        },
        balance: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: false,
          defaultValue: 0
        },
        active: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true
        }
      },
      {
        seq,
        modelName: 'User',
        timestamps: true
      }
    );
  }
}

const seq = new Seq({
  adapter: new MapAdapter(),
  models: [User],
  naming: {
    tables: 'snake_case',
    columns: 'snake_case'
  },
  logging: console.log
});

await seq.init();
await seq.sync();

const user = await User.create({ name: 'Ana', email: 'ana@test.com' });
console.log(user.toJSON());

await seq.close();
```

## Tipos de Datos

| Tipo | Ejemplo | Descripción |
|------|---------|-------------|
| `INTEGER` | `DataTypes.INTEGER` | Números enteros |
| `DECIMAL(p, s)` | `DataTypes.DECIMAL(12, 2)` | Decimal con precisión y escala |
| `NUMBER(p, s)` | `DataTypes.NUMBER(10, 0)` | Numérico con precisión y escala |
| `STRING(len)` | `DataTypes.STRING(100)` | Cadena de texto con longitud máxima (por defecto: 255) |
| `BOOLEAN` | `DataTypes.BOOLEAN` | Valores booleanos |
| `DATE` | `DataTypes.DATE` | Instancias de Date |
| `ARRAY(type)` | `DataTypes.ARRAY(DataTypes.STRING(50))` | Arreglo con validación opcional de tipo de elemento |
| `OBJECT` | `DataTypes.OBJECT` | Objetos simples (rechaza arreglos, Dates, instancias de clases) |
| `JSON` | `DataTypes.JSON` | Objetos serializables a JSON (rechaza funciones, undefined, symbols) |

Todos los tipos aceptan `null` como valor válido. Cada tipo implementa `validate(value)` retornando `{ valid: boolean, message: string }`.

## Opciones del Modelo

```js
Model.init(attributes, {
  seq,           // Instancia de Seq (requerido)
  modelName,     // Nombre del modelo (por defecto: nombre de la clase)
  tableName,     // Nombre de la tabla (por defecto: derivado de modelName via convenciones de nombre)
  timestamps,    // true/false (por defecto: true)
  createdAt,     // Nombre personalizado del campo createdAt (por defecto: 'createdAt')
  updatedAt      // Nombre personalizado del campo updatedAt (por defecto: 'updatedAt')
});
```

## Opciones de Atributos

```js
{
  type,           // Tipo DataTypes (requerido)
  primaryKey,     // Booleano (solo uno por modelo)
  autoIncrement,  // Booleano (solo uno por modelo)
  allowNull,      // Booleano (por defecto: true)
  defaultValue,   // Valor o función (() => valor)
  unique,         // Booleano (por defecto: false)
  field           // Nombre personalizado de columna (omite las convenciones de nombre)
  references      // { model, key, constraintName, onDelete, onUpdate } — FK directa
}
```

Cuando se establece `unique: true`, el adapter enforce la unicidad en esa columna:
- **Adapter Map**: Escanea la tabla en insert/update y lanza `SEQ_VALIDATION_UNIQUE` en caso de duplicados
- **Adapters de base de datos**: Deben traducir esto a un constraint `UNIQUE` o `CREATE UNIQUE INDEX` en DDL

Se permiten múltiples valores `null` en columnas únicas (según el estándar SQL).

## Opciones de Consulta

```js
// where — solo comparación por igualdad
await User.findAll({ where: { active: true } });

// order — arreglo de pares [atributo, dirección]
await User.findAll({ order: [['name', 'ASC'], ['createdAt', 'DESC']] });

// limit y offset
await User.findAll({ limit: 10, offset: 20 });
```

## Operaciones CRUD

### Métodos Estáticos

```js
// Crear
const user = await User.create({ name: 'Ana', email: 'ana@test.com' });
const users = await User.bulkCreate([
  { name: 'Juan', email: 'juan@test.com' },
  { name: 'Pedro', email: 'pedro@test.com' }
]);

// Leer
const byPk = await User.findByPk(1);
const one = await User.findOne({ where: { name: 'Ana' } });
const all = await User.findAll({ where: { active: true }, limit: 10 });
const count = await User.count({ where: { active: true } });

// Actualizar
await User.update({ balance: 200 }, { where: { name: 'Ana' } });

// Eliminar
await User.destroy({ where: { name: 'Ana' } });
await User.truncate();
```

### Métodos de Instancia

```js
const user = await User.findByPk(1);

// Obtener valores
user.getDataValue('name');     // 'Ana'
user.get();                    // { id: 1, name: 'Ana', ... }
user.toJSON();                 // igual a get()

// Establecer valores
user.setDataValue('name', 'Ana Maria');

// Persistir cambios
await user.save();
await user.update({ balance: 300 });
await user.destroy();
```

### Build (sin persistir)

```js
const user = User.build({ name: 'Ana', email: 'ana@test.com' });
console.log(user.getDataValue('name')); // 'Ana'
// Aún no se ha guardado en la base de datos
await user.save();
```

## Convenciones de Nombre

seq soporta convenciones de nombre automáticas para tablas y columnas, para que puedas usar camelCase en JavaScript mientras la base de datos usa snake_case.

### Configuración

```js
const seq = new Seq({
  adapter: new MapAdapter(),
  models: [User, Product],
  naming: {
    tables: 'snake_case',   // o 'camelCase'
    columns: 'snake_case',  // o 'camelCase'
    prefix: 'app'           // prefijo opcional
  }
});
```

### Cómo Funciona

| Origen | Convención | Resultado |
|--------|-----------|-----------|
| `modelName: 'UserProfile'` | `snake_case` | tabla: `user_profiles` |
| `modelName: 'UserProfile'` | `snake_case` + prefijo `'app'` | tabla: `app_user_profiles` |
| atributo `productName` | `snake_case` | columna: `product_name` |
| atributo `createdAt` | `snake_case` | columna: `created_at` |

### Omitir Convenciones

Los valores explícitos omiten las convenciones de nombre:

```js
// tableName explícito — no se aplica convención
{ seq, modelName: 'User', tableName: 'users' }

// field explícito — no se aplica convención para esa columna
{ email: { type: DataTypes.STRING(150), field: 'user_email' } }
```

### Estilo de Case del Adapter

El adapter determina el casing final de los identificadores. El adapter Map usa `'lower'` por defecto. Los adapters de base de datos pueden sobreescribir `get caseStyle()` para retornar `'upper'` (por ejemplo, los identificadores de Oracle típicamente son mayúsculas).

## Transacciones

```js
// Commit/rollback automático
await seq.transaction(async (t) => {
  const user = await User.create(
    { name: 'Ana', balance: 100 },
    { transaction: t }
  );
  await user.update({ balance: 0 }, { transaction: t });
});
// Se confirma automáticamente en éxito, se revierte en error
```

El adapter Map usa una estrategia basada en **snapshots**: `begin()` crea snapshots de todas las tablas, `commit()` descarta los snapshots, `rollback()` restaura desde los snapshots.

## Asociaciones

seq soporta relaciones entre modelos con validación de llaves foráneas en DML y cascade configurable.

### Declaración

Las asociaciones se declaran **antes** de `seq.init()`. El modelo hijo debe tener el atributo FK definido manualmente.

```js
class User extends Model {
  static define(seq) {
    return this.init(
      { id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true }, name: DataTypes.STRING(100) },
      { seq, modelName: 'User' }
    );
  }
}

class Task extends Model {
  static define(seq) {
    return this.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        title: DataTypes.STRING(100),
        userId: { type: DataTypes.INTEGER, allowNull: false }  // FK attribute manual
      },
      { seq, modelName: 'Task' }
    );
  }
}

User.hasMany(Task, { foreignKey: 'userId', onDelete: 'CASCADE' });
Task.belongsTo(User, { foreignKey: 'userId' });
```

### Tipos de Asociación

| Método | Descripción | FK se define en |
|--------|-------------|-----------------|
| `Source.hasMany(Target, opts)` | Uno a muchos | Modelo Target |
| `Source.hasOne(Target, opts)` | Uno a uno (FK unique en Target) | Modelo Target |
| `Source.belongsTo(Target, opts)` | Inverso de hasMany/hasOne | Modelo Source |
| `Source.belongsTo(Target, opts)` | FK directa en atributos con `references` | Modelo Source |

### Opciones

```js
Model.hasMany(Target, {
  foreignKey: 'userId',    // Nombre del atributo FK (por defecto: modelName + 'Id')
  onDelete: 'CASCADE',     // RESTRICT (por defecto) | CASCADE | SET NULL
  onUpdate: 'RESTRICT'     // RESTRICT (por defecto) | CASCADE | SET NULL
});
```

### Validación de FK

- **INSERT**: Verifica que el valor FK exista en la tabla referenciada. Error: `SEQ_VALIDATION_FK`
- **UPDATE**: Verifica FK si se cambia el valor. Error: `SEQ_VALIDATION_FK`
- **DELETE (RESTRICT)**: Impide borrar si hay registros hijos referenciando. Error: `SEQ_VALIDATION_FK_RESTRICT`
- **DELETE (CASCADE)**: Elimina registros hijos automáticamente
- **DELETE (SET NULL)**: Pone el FK en null en registros hijos
- **UPDATE CASCADE en PK**: Actualiza los FK hijos cuando cambia la PK del padre

### Atributo `references` en Definición

También puedes declarar FK directamente en los atributos:

```js
{
  userId: {
    type: DataTypes.INTEGER,
    references: { model: 'User', key: 'id', constraintName: 'fk_tasks_users' },
    onDelete: 'CASCADE',
    onUpdate: 'RESTRICT'
  }
}
```

Las asociaciones `hasMany`/`belongsTo` declaradas externamente fusionan sus opciones de cascade con las declaradas en `references`.

### Constraint Names (nombre de FK)

Cada FK tiene un `constraintName` que se almacena en el schema de la tabla:

- **Explícito** en `references`: `{ model: 'User', key: 'id', constraintName: 'mi_fk' }`
- **Explícito** en asociaciones: `User.hasMany(Task, { constraintName: 'mi_fk' })`
- **Auto-generado** cuando no se especifica: `fk_{source_table}_{target_table}`

```js
// Auto-generado: "fk_tasks_users"
User.hasMany(Task, { foreignKey: 'userId' });

// Auto-generado: "fk_profiles_users"
User.hasOne(Profile, { foreignKey: 'userId' });

// Explícito: "custom_fk"
User.hasMany(Task, { foreignKey: 'userId', constraintName: 'custom_fk' });

// En references: "custom_fk"
{ userId: { type: DataTypes.INTEGER, references: { model: 'User', key: 'id', constraintName: 'custom_fk' } } }
```

El `constraintName` aparece en los mensajes de error de FK:

```
Foreign key constraint "fk_tasks_users": value "999" for "userId" does not exist in "User.id"
```

## Errores

Todos los errores extienden `SeqError` e incluyen una propiedad `code` y un objeto opcional `details`.

```js
import { SeqError, ValidationError, AdapterError } from './src/index.js';

try {
  await User.create({ name: null });
} catch (err) {
  console.log(err.code);     // 'SEQ_VALIDATION_NOT_NULL'
  console.log(err.message);  // 'Field "name" does not allow null values in model "User"'
  console.log(err.details);  // { model: 'User', field: 'name' }
}
```

### Jerarquía de Errores

```
SeqError
  ├── ConfigurationError   (SEQ_MISSING_ADAPTER, etc.)
  ├── ModelError           (SEQ_MODEL_MISSING_NAME, SEQ_MODEL_DUPLICATE, etc.)
  ├── ValidationError      (SEQ_VALIDATION_NOT_NULL, SEQ_VALIDATION_TYPE, etc.)
  └── AdapterError         (SEQ_ADAPTER_TABLE_NOT_FOUND, etc.)
```

### Códigos de Error Comunes

| Código | Descripción |
|--------|-------------|
| `SEQ_VALIDATION_NOT_NULL` | El campo no permite valores nulos |
| `SEQ_VALIDATION_TYPE` | Falló la validación de tipo |
| `SEQ_VALIDATION_LENGTH` | La cadena excede la longitud máxima |
| `SEQ_VALIDATION_UNIQUE` | Valor duplicado en columna única |
| `SEQ_VALIDATION_DUPLICATE_PK` | Valor duplicado de llave primaria |
| `SEQ_VALIDATION_FK` | Violación de llave foránea (valor no existe en tabla referenciada) |
| `SEQ_VALIDATION_FK_RESTRICT` | No se puede eliminar: registro referenciado por otro modelo |
| `SEQ_ADAPTER_TABLE_NOT_FOUND` | Operación sobre tabla inexistente |
| `SEQ_ADAPTER_TABLE_EXISTS` | createTable sobre tabla existente |

## Crear un Adapter Personalizado

Extiende `BaseAdapter` e implementa los grupos abstractos DDL, DML, DCL y TCL. Cada grupo tiene una clase base con métodos abstractos y helpers compartidos.

```js
import { BaseAdapter } from 'seq';
import { DDLAbstract } from 'seq';
import { DMLAbstract } from 'seq';

class MyDDL extends DDLAbstract {
  async createTable(definition, options) {
    const def = this.normalizeDefinition(definition);
    // Generar y ejecutar SQL CREATE TABLE
    // Incluir constraints UNIQUE para columnas con unique: true
  }
  // ... implementar dropTable, hasTable, describeTable, alterTable, listTables
}

class MyDML extends DMLAbstract {
  async insert(model, values, options) {
    // Generar y ejecutar SQL INSERT
    // La unicidad la enforce la base de datos (constraint UNIQUE del DDL)
  }
  // ... implementar selectByPk, selectOne, selectAll, count, update, delete, truncate
}

class MyAdapter extends BaseAdapter {
  get caseStyle() { return 'upper'; }  // Identificadores estilo Oracle
  constructor(options) {
    super(options);
    this.ddl = new MyDDL(this);
    this.dml = new MyDML(this);
    this.dcl = new MapDCL(this);  // reutilizar si no se necesita DCL
    this.tcl = new MyTCL(this);
  }
}
```

### Clases Abstractas Base

| Clase | Métodos | Helpers Compartidos |
|-------|---------|---------------------|
| `DDLAbstract` | `createTable`, `dropTable`, `hasTable`, `describeTable`, `alterTable`, `listTables` | `normalizeDefinition()`, `diffColumns()` |
| `DMLAbstract` | `insert`, `bulkInsert`, `selectByPk`, `selectOne`, `selectAll`, `count`, `update`, `delete`, `truncate` | `_toColumnNames()`, `_toAttrNames()`, `_translateWhere()`, `_matchWhere()`, `_validateRecord()` |
| `DCLAbstract` | `grant`, `revoke` | (lanza "no soportado" por defecto) |
| `TCLAbstract` | `begin`, `commit`, `rollback` | `_validateTransaction()` |

### Enforce de Unicidad

Cómo se enforce `unique: true` depende del adapter:

- **Adapter Map**: `MapDML._checkUniqueConstraint()` escanea la tabla en memoria en cada insert y update
- **Adapters de base de datos**: Traducen `unique: true` a un constraint `UNIQUE` en DDL. El motor de la base de datos lo enforce a nivel DML — no se necesita escaneo a nivel de aplicación

## Arquitectura

```
Código del Usuario
  │
  ▼
Seq (punto de entrada, configuración, sync, transacciones, naming)
  │
  ├── ModelRegistry (mapeo nombre→clase, protección contra duplicados)
  ├── Model (CRUD estático + save/update/destroy de instancia)
  ├── Association (metadatos de relaciones: type, foreignKey, cascade)
  ├── DataTypes (9 tipos con validación)
  ├── Naming Utils (toSnakeCase, toCamelCase, applyConvention, applyCase)
  ├── Jerarquía de Errores (SeqError → ConfigurationError, ModelError, ValidationError, AdapterError)
  │
  ▼
BaseAdapter (contrato: connect, close, inspect, mapDataType, caseStyle)
  │
  ├── DDLAbstract → createTable, dropTable, hasTable, describeTable, alterTable, listTables
  ├── DMLAbstract → insert, bulkInsert, selectByPk, selectOne, selectAll, count, update, delete, truncate
  ├── DCLAbstract → grant, revoke
  ├── TCLAbstract → begin, commit, rollback
  │
  ▼
MapAdapter (en memoria usando Map<tableName, Map<pk, record>>)
  ├── MapDDL   (almacena schema en adapter.schemas, incluye foreignKeys)
  ├── MapDML   (CRUD + validación unicidad + validación FK + cascade delete/update)
  ├── MapDCL   (no soportado)
  └── MapTCL   (rollback basado en snapshots)
```

Principios de diseño clave:
- `Model` nunca conoce la estructura interna del adapter
- El core nunca opera directamente sobre Map
- DDL/DML/DCL/TCL están claramente separados
- Los tipos de datos son abstractos y convertidos por los adapters
- Todos los métodos son asíncronos para compatibilidad futura con bases de datos
- Las convenciones de nombre son aplicadas por Seq, no por el adapter

## Ejecutar

```bash
npm install
npm test
node examples/basic.js
node examples/associations.js
```

## Limitaciones Actuales

- Almacenamiento en memoria solamente (sin bases de datos reales)
- Sin generación de SQL
- Sin llaves primarias compuestas
- Sin hooks o scopes
- Sin migraciones
- Sin operadores avanzados (Op.like, Op.in, etc.)
- Sin soporte DCL (grant/revoke)
- Sin pool de conexiones

## Próximos Pasos

- Adapter Oracle <12
- Adapter Oracle >=12
- Adapter MySQL
- Adapter PostgreSQL
- Generación de SQL
- ~~Asociaciones (belongsTo, hasMany, belongsToMany)~~ ✅
- Operadores avanzados
- Hooks
- Scopes
- Migraciones
