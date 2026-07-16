# seq

`seq` es un micro ORM modular para Node.js, inspirado en Sequelize y pensado para crecer por adapters. Actualmente incluye un adapter en memoria (`MapAdapter`) y un adapter SQLite basado en `better-sqlite3` (`SQLiteAdapter`).

El paquete expone modelos, tipos de datos, asociaciones, operadores de consulta, hooks, sincronizacion de schema y transacciones con una API asincrona.

## Requisitos

- Node.js 22 o superior
- npm

## Instalacion

```bash
npm install
```

## Inicio rapido con SQLite

```js
import { Seq, Model, DataTypes, SQLiteAdapter } from 'seq';

class User extends Model {
  static define(seq) {
    return this.init(
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false
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

const adapter = new SQLiteAdapter({ database: ':memory:' });

const seq = new Seq({
  adapter,
  models: [User],
  naming: {
    tables: 'snake_case',
    columns: 'snake_case'
  },
  logging: false
});

await seq.init();
await seq.sync();

const user = await User.create({
  name: 'Ana',
  email: 'ana@example.com'
});

console.log(user.toJSON());

await seq.close();
```

En desarrollo local tambien se puede importar desde `./src/index.js`, como hacen los ejemplos del repositorio.

## API exportada

```js
import {
  Seq,
  Model,
  ModelRegistry,
  Association,
  BaseAdapter,
  MapAdapter,
  SQLiteAdapter,
  DataTypes,
  Op,
  SeqError,
  ConfigurationError,
  ModelError,
  ValidationError,
  AdapterError
} from 'seq';
```

## Configuracion de Seq

```js
const seq = new Seq({
  adapter: new SQLiteAdapter({ database: 'app.sqlite' }),
  models: [User, Task],
  logging: {
    info: console.log,
    trace: false,
    warning: false,
    error: console.error
  },
  define: {},
  naming: {
    tables: 'snake_case',
    columns: 'snake_case',
    prefix: 'app'
  }
});
```

Opciones principales:

| Opcion | Descripcion |
| --- | --- |
| `adapter` | Adapter activo. Es requerido. |
| `models` | Clases que extienden `Model`. |
| `logging` | `false`, `true`, funcion u objeto por niveles. |
| `define` | Opciones por defecto reservadas para definicion de modelos. |
| `naming.tables` | Convencion de tablas: `snake_case` o `camelCase`. |
| `naming.columns` | Convencion de columnas: `snake_case` o `camelCase`. |
| `naming.prefix` | Prefijo global opcional para tablas. |

## Logging

Por defecto, `seq` registra mensajes `info` con `console.log` y mensajes `error` con `console.error`. Los niveles `trace` y `warning` vienen desactivados.

```js
const seq = new Seq({
  adapter,
  models: [User],
  logging: {
    info: console.log,
    trace: console.debug,
    warning: console.warn,
    error: console.error
  }
});
```

Tambien se puede desactivar todo:

```js
const seq = new Seq({
  adapter,
  models: [User],
  logging: false
});
```

Para mantener compatibilidad, `logging: true` activa los defaults y `logging: fn` usa esa funcion como logger de `info`. Los logs SQL del adapter SQLite se emiten en `trace`.

## Definir modelos

Un modelo debe extender `Model` y definir sus atributos con `init()`. La forma mas comun en este repo es implementar `static define(seq)`.

```js
class Task extends Model {
  static define(seq) {
    return this.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        title: { type: DataTypes.STRING(100), allowNull: false },
        completed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        userId: { type: DataTypes.INTEGER, allowNull: false }
      },
      {
        seq,
        modelName: 'Task',
        timestamps: false
      }
    );
  }
}
```

Opciones de modelo:

| Opcion | Descripcion |
| --- | --- |
| `seq` | Instancia de `Seq`. |
| `modelName` | Nombre logico del modelo. Por defecto usa el nombre de la clase. |
| `tableName` | Nombre fisico de la tabla. Si se define, no se aplica convencion automatica. |
| `timestamps` | Agrega `createdAt` y `updatedAt`. Por defecto es `true`. |
| `createdAt` | Nombre personalizado para el campo de creacion. |
| `updatedAt` | Nombre personalizado para el campo de actualizacion. |
| `hooks` | Hooks iniciales del modelo. |
| `alias` | Alias usado por includes/asociaciones. |

Opciones de atributo:

| Opcion | Descripcion |
| --- | --- |
| `type` | Tipo de `DataTypes`. Requerido. |
| `primaryKey` | Marca la llave primaria. Solo se admite una por modelo. |
| `autoIncrement` | Autoincremento. Solo se admite uno por modelo. |
| `allowNull` | Permite `null`. Por defecto es `true`. |
| `defaultValue` | Valor por defecto o funcion `() => value`. |
| `unique` | Crea/enforcea una restriccion unica. |
| `field` | Nombre fisico de columna. Omite la convencion para ese atributo. |
| `references` | FK directa: `{ model, key, constraintName }`. |
| `onDelete` | Accion FK: `RESTRICT`, `CASCADE` o `SET NULL`. |
| `onUpdate` | Accion FK: `RESTRICT`, `CASCADE` o `SET NULL`. |

## Tipos de datos

| Tipo | Ejemplo |
| --- | --- |
| `INTEGER` | `DataTypes.INTEGER` |
| `DECIMAL(p, s)` | `DataTypes.DECIMAL(12, 2)` |
| `NUMBER(p, s)` | `DataTypes.NUMBER(10, 0)` |
| `STRING(len)` | `DataTypes.STRING(100)` |
| `BOOLEAN` | `DataTypes.BOOLEAN` |
| `DATE` | `DataTypes.DATE` |
| `ARRAY(type)` | `DataTypes.ARRAY(DataTypes.STRING(50))` |
| `OBJECT` | `DataTypes.OBJECT` |
| `JSON` | `DataTypes.JSON` |

Cada tipo implementa `validate(value)` y retorna `{ valid, message }`. Los valores `null` son validos a nivel de tipo; la nulabilidad de un atributo se controla con `allowNull`.

## CRUD

```js
const ana = await User.create({ name: 'Ana', email: 'ana@example.com' });

const users = await User.bulkCreate([
  { name: 'Juan', email: 'juan@example.com' },
  { name: 'Luis', email: 'luis@example.com' }
]);

const byPk = await User.findByPk(1);
const one = await User.findOne({ where: { email: 'ana@example.com' } });
const all = await User.findAll({ where: { active: true }, limit: 10 });
const total = await User.count({ where: { active: true } });

await User.update({ active: false }, { where: { name: 'Luis' } });
await User.destroy({ where: { name: 'Luis' } });
await User.truncate();
```

Instancias:

```js
const user = User.build({ name: 'Ana', email: 'ana@example.com' });

await user.save();

user.setDataValue('name', 'Ana Maria');
await user.save();

await user.update({ active: false });
await user.destroy();

console.log(user.getDataValue('name'));
console.log(user.get());
console.log(user.toJSON());
```

`Model.create()` inserta directamente y ejecuta hooks de create. `instance.save()` ejecuta hooks de save y luego los hooks de create/update segun corresponda.

## Consultas y operadores

```js
import { Op } from 'seq';

await Task.findAll({
  where: {
    completed: false,
    priority: { [Op.gte]: 2 }
  },
  order: [['priority', 'DESC']],
  limit: 10,
  offset: 0
});

await Task.findAll({ where: { title: { [Op.like]: '%docs%' } } });
await Task.findAll({ where: { id: { [Op.in]: [1, 3, 5] } } });
await Task.findAll({ where: { priority: { [Op.between]: [1, 3] } } });
```

Operadores disponibles:

| Operador | Uso |
| --- | --- |
| `Op.eq` | Igualdad explicita |
| `Op.ne` | Distinto |
| `Op.gt`, `Op.gte` | Mayor que, mayor o igual |
| `Op.lt`, `Op.lte` | Menor que, menor o igual |
| `Op.like`, `Op.notLike` | Patron SQL-like |
| `Op.in`, `Op.notIn` | Incluido/no incluido en una lista |
| `Op.between`, `Op.notBetween` | Dentro/fuera de un rango |

## Asociaciones e include

seq soporta:

- `hasMany`
- `hasOne`
- `belongsTo`
- `belongsToMany`

Las asociaciones deben declararse antes de `seq.init()`. En `hasMany`, `hasOne` y `belongsTo`, el atributo FK debe existir en el modelo que lo guarda.

```js
User.hasMany(Task, { foreignKey: 'userId', onDelete: 'CASCADE' });
Task.belongsTo(User, { foreignKey: 'userId' });

const users = await User.findAll({ include: Task });
```

Para muchos-a-muchos, `sync()` crea la tabla intermedia a partir de `through`.

```js
User.belongsToMany(Role, {
  through: 'user_roles',
  foreignKey: 'userId',
  otherKey: 'roleId'
});

Role.belongsToMany(User, {
  through: 'user_roles',
  foreignKey: 'roleId',
  otherKey: 'userId'
});

const users = await User.findAll({ include: Role });
const eagerUsers = await User.findAll({ include: Role, eager: true });
```

Tambien se puede pasar un objeto de include:

```js
await Role.findAll({
  include: [{ model: Permission, where: { name: 'read' } }],
  eager: true
});
```

## Hooks

Los hooks pueden declararse en `init()` o agregarse despues con `addHook()`.

```js
class Customer extends Model {
  static define(seq) {
    return this.init(
      {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        name: { type: DataTypes.STRING(100), allowNull: false },
        email: { type: DataTypes.STRING(150), allowNull: false }
      },
      {
        seq,
        modelName: 'Customer',
        timestamps: false,
        hooks: {
          beforeCreate(values) {
            values.email = values.email.trim().toLowerCase();
          }
        }
      }
    );
  }
}

Customer.addHook('beforeFind', options => {
  options.where = { ...(options.where || {}), active: true };
});
```

Hooks disponibles:

| Operacion | Hooks |
| --- | --- |
| `create()` | `beforeCreate`, `afterCreate` |
| `bulkCreate()` | `beforeBulkCreate`, `afterBulkCreate` |
| `findOne()`, `findAll()` | `beforeFind`, `afterFind` |
| `count()` | `beforeCount`, `afterCount` |
| `update()` | `beforeUpdate`, `afterUpdate` |
| `destroy()` | `beforeDestroy`, `afterDestroy` |
| `truncate()` | `beforeTruncate`, `afterTruncate` |
| `instance.save()` | `beforeSave`, `beforeCreate`/`beforeUpdate`, `afterCreate`/`afterUpdate`, `afterSave` |

Todos los hooks se pueden desactivar por operacion con `{ hooks: false }`.

## Transacciones

```js
await seq.transaction(async transaction => {
  const user = await User.create(
    { name: 'Ana', email: 'ana@example.com' },
    { transaction }
  );

  await user.update({ active: false }, { transaction });
});
```

`seq.transaction()` hace commit si el callback termina correctamente y rollback si lanza un error.

## Sincronizacion

```js
await seq.sync();
await seq.sync({ alter: true });
await seq.sync({ force: true });
```

`sync()` crea tablas faltantes. Con `alter` intenta ajustar tablas existentes. Con `force` elimina y recrea.

El resultado tiene esta forma:

```js
{
  created: [],
  existing: [],
  altered: [],
  dropped: []
}
```

## Adaptadores

### SQLiteAdapter

```js
const adapter = new SQLiteAdapter({ database: ':memory:' });
const fileAdapter = new SQLiteAdapter({ database: 'database.sqlite' });
```

El adapter SQLite usa `better-sqlite3`, ejecuta DDL/DML real y soporta inserts masivos mediante transacciones nativas en `bulkInsert()`.

### MapAdapter

```js
const adapter = new MapAdapter();
```

El adapter Map guarda datos en memoria usando `Map`. Es util para pruebas, prototipos y para validar el contrato comun de adapters.

## Errores

Todos los errores propios extienden `SeqError` e incluyen `code` y opcionalmente `details`.

```js
try {
  await User.create({ name: null });
} catch (error) {
  console.log(error.code);
  console.log(error.message);
  console.log(error.details);
}
```

Jerarquia:

```text
SeqError
  ConfigurationError
  ModelError
  ValidationError
  AdapterError
```

Codigos comunes:

| Codigo | Descripcion |
| --- | --- |
| `SEQ_MISSING_ADAPTER` | Falta configurar un adapter. |
| `SEQ_MODEL_DUPLICATE` | Modelo duplicado en el registry. |
| `SEQ_VALIDATION_NOT_NULL` | Campo requerido con valor `null`. |
| `SEQ_VALIDATION_TYPE` | Valor incompatible con el tipo. |
| `SEQ_VALIDATION_LENGTH` | String excede la longitud maxima. |
| `SEQ_VALIDATION_UNIQUE` | Violacion de unicidad. |
| `SEQ_VALIDATION_DUPLICATE_PK` | Llave primaria duplicada. |
| `SEQ_VALIDATION_FK` | FK inexistente o invalida. |
| `SEQ_VALIDATION_FK_RESTRICT` | Delete/update bloqueado por FK restrictiva. |
| `SEQ_ADAPTER_TABLE_NOT_FOUND` | Tabla inexistente. |
| `SEQ_ADAPTER_TABLE_EXISTS` | Tabla ya existente. |

## Scripts del repo

```bash
npm test
npm run test:watch
npm run basic
npm run associations
npm run find
npm run include
npm run belongs-to-many
npm run hooks
npm run examples
```

`npm run examples` ejecuta la cadena completa de ejemplos.

## Estructura

```text
src/
  adapters/
    abstract/       Contratos DDL, DML, DCL y TCL
    map/            Adapter en memoria
    sqlite/         Adapter SQLite
  core/             Seq, Model, Association, ModelRegistry y errores
  data-types/       Tipos y validaciones
  utils/            Naming, where, include, clone y validacion
  index.js          Superficie publica
examples/           Ejemplos ejecutables
tests/              Suite node:test
```

## Estado actual y limites

Implementado:

- SQLite y almacenamiento en memoria
- CRUD estatico e instancias
- `bulkCreate()` con ruta `bulkInsert()`
- `where`, `order`, `limit`, `offset`
- Operadores `Op`
- Asociaciones e `include`
- Hooks por modelo
- Timestamps
- Convenciones de nombres
- Transacciones
- Errores tipados

Limitaciones conocidas:

- Sin llaves primarias compuestas
- Sin migraciones versionadas
- Sin scopes
- Sin pool de conexiones
- Los operadores logicos `Op.and` y `Op.or` existen en la API, pero su comportamiento aun no esta estable en todos los adapters
- DCL (`grant`/`revoke`) no esta implementado
- `belongsToMany` crea tablas intermedias, pero la insercion en esas tablas se hace con SQL/adaptador directo en los ejemplos actuales
