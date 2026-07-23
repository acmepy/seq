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
  logging: false
});

await seq.authenticate();
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
  adapter: new SQLiteAdapter({
    database: 'app.sqlite',
    naming: {
      prefix: 'app',
      caseStyle: 'lower'
    },
    fkStrategy: 'inline',
    eager: false
  }),
  models: [User, Task],
  logging: {
    info: console.log,
    trace: false,
    warn: false,
    error: console.error
  },
  define: {}
});
```

Opciones principales:

| Opcion | Descripcion |
| --- | --- |
| `adapter` | Adapter activo. Es requerido. |
| `models` | Clases que extienden `Model`. |
| `logging` | `false`, `true`, funcion u objeto por niveles. |
| `define` | Opciones por defecto reservadas para definicion de modelos. |

## Configuracion de adapters

Los adapters aceptan opciones comunes para ajustar nombres fisicos y estrategias internas:

```js
const adapter = new SQLiteAdapter({
  database: 'app.sqlite',
  naming: {
    tables: 'snake_case',
    columns: 'snake_case',
    prefix: 'app',
    caseStyle: 'lower'
  },
  fkStrategy: 'inline', // 'alter', 'inline' o 'none'
  eager: true           // default para includes
});
```

| Opcion | Descripcion |
| --- | --- |
| `naming.tables` | Convencion de tablas: `snake_case` o `camelCase`. |
| `naming.columns` | Convencion de columnas: `snake_case` o `camelCase`. |
| `naming.prefix` | Prefijo global opcional para tablas. |
| `naming.caseStyle` | Fuerza el case fisico de tablas/columnas: `'lower'`, `'upper'` o `null` para no transformar. |
| `fkStrategy` | Estrategia de FK: `'alter'`, `'inline'` o `'none'`. SQLite usa `'inline'` por defecto y Map usa `'none'`. |
| `eager` | Default global del adapter para includes. Si es `true`, `findAll({ include })` usa JOIN salvo override con `eager: false`. |

Defaults:

| Adapter | `fkStrategy` | `eager` |
| --- | --- | --- |
| `BaseAdapter` | `'alter'` | `false` |
| `SQLiteAdapter` | `'inline'` | `false` |
| `MapAdapter` | `'none'` | `false` |

Defaults de naming:

| Adapter | `tables` | `columns` | `prefix` | `caseStyle` |
| --- | --- | --- | --- | --- |
| `BaseAdapter` | Sin convencion | Sin convencion | Sin prefijo | Sin transformar |
| `SQLiteAdapter` | `snake_case` | `snake_case` | Sin prefijo | `'lower'` |
| `MapAdapter` | `camelCase` | `camelCase` | Sin prefijo | `'lower'` |

La prioridad de `eager` es: include individual, opcion de query, opcion del adapter, y finalmente `false`.

## Logging

Por defecto, `seq` registra mensajes `info` con `console.log` y mensajes `error` con `console.error`. Los niveles `trace` y `warn` vienen desactivados.

```js
const seq = new Seq({
  adapter,
  models: [User],
  logging: {
    info: console.log,
    trace: console.debug,
    warn: console.warn,
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

La clave `warn` usa la misma convencion que `console.warn` y loggers como `com.acmepy.logger-js`, cuyos metodos reciben primero el origen del mensaje y luego los datos:

```js
import { createLogger, logger, LEVELS } from 'com.acmepy.logger-js';

createLogger({
  name: '[seq]',
  displayConsole: true,
  level: LEVELS.INFO
});

const seq = new Seq({
  adapter,
  models: [User],
  logging: {
    info: logger.info.bind(logger),
    trace: logger.trace.bind(logger),
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger)
  }
});
```

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
| `validate.len` | Valida longitud con `[min, max]`. |
| `validate.isEmail` | Valida formato de email basico. |

## Compatibilidad con `sequelize.define`

Tambien se puede definir modelos con un estilo cercano a Sequelize usando `seq.define(nombre, atributos, opciones)`. Esto permite migrar archivos existentes con cambios pequenos: cambiar el import, recibir una instancia `Seq`, y mantener `associate(models)` si ya existe.

```js
import { DataTypes } from 'seq';

export default function init(seq) {
  const usuarios = seq.define(
    'usuarios',
    {
      id: { type: DataTypes.STRING, primaryKey: true },
      usuario: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true,
        validate: { len: [3, 20] }
      },
      correo: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: { isEmail: true }
      },
      rolId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'roles', key: 'id' }
      }
    },
    {
      timestamps: false,
      tableName: 'repUsuarios',
      labels: {
        usuario: 'Usuario',
        correo: 'Correo'
      }
    }
  );

  usuarios.associate = (models) => {
    usuarios.belongsTo(models.roles, { foreignKey: 'rolId' });
  };

  usuarios.list = async () => await usuarios.findAll({ attributes: ['id', 'usuario'] });

  return usuarios;
}
```

`seq.models` conserva comportamiento de array y ademas expone accesos por nombre de modelo o tabla, por ejemplo `seq.models.usuarios` y `seq.models.repUsuarios`.

## Tipos de datos

| Tipo | Ejemplo |
| --- | --- |
| `INTEGER` | `DataTypes.INTEGER` |
| `DECIMAL(p, s)` | `DataTypes.DECIMAL(12, 2)` |
| `NUMBER(p, s)` | `DataTypes.NUMBER(10, 0)` |
| `STRING(len)` | `DataTypes.STRING` o `DataTypes.STRING(100)` |
| `BOOLEAN` | `DataTypes.BOOLEAN` |
| `DATE` | `DataTypes.DATE` |
| `ARRAY(type)` | `DataTypes.ARRAY(DataTypes.STRING(50))` |
| `OBJECT` | `DataTypes.OBJECT` |
| `JSON` | `DataTypes.JSON` |
| `VIRTUAL` | `DataTypes.VIRTUAL` |

Cada tipo implementa `validate(value)` y retorna `{ valid, message }`. Los valores `null` son validos a nivel de tipo; la nulabilidad de un atributo se controla con `allowNull`.

Los atributos `VIRTUAL` existen solo en la instancia del modelo: no crean columnas, no se insertan ni se actualizan en la base. Se pueden usar con `get` y `set` para valores derivados.

```js
const User = seq.define('User', {
  firstName: { type: DataTypes.STRING(100), allowNull: false },
  lastName: { type: DataTypes.STRING(100), allowNull: false },
  fullName: {
    type: DataTypes.VIRTUAL(DataTypes.STRING(200), ['firstName', 'lastName']),
    get() {
      return `${this.getDataValue('firstName')} ${this.getDataValue('lastName')}`;
    },
    set(value) {
      const [firstName, ...lastName] = String(value).split(' ');
      this.setDataValue('firstName', firstName);
      this.setDataValue('lastName', lastName.join(' '));
    }
  }
}, { timestamps: false });
```

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
const page = await User.findAndCountAll({
  where: { active: true },
  order: [['name', 'ASC']],
  limit: 10,
  offset: 0
});

await User.update({ active: false }, { where: { name: 'Luis' } });
await User.destroy({ where: { name: 'Luis' } });
await User.truncate();
```

`findAndCountAll()` retorna `{ count, rows }`. `rows` respeta `limit`, `offset` y `order`; `count` devuelve el total de registros que coinciden con el `where` sin paginacion.

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

Las asociaciones deben declararse antes de inicializar la instancia, ya sea con `seq.authenticate()` o `seq.init()`. En `hasMany`, `hasOne` y `belongsTo`, el atributo FK debe existir en el modelo que lo guarda.

```js
User.hasMany(Task, { foreignKey: 'userId', onDelete: 'CASCADE' });
Task.belongsTo(User, { foreignKey: 'userId' });

const users = await User.findAll({ include: Task });
```

Para muchos-a-muchos, `through` puede ser el nombre de la tabla intermedia o un modelo que represente esa tabla.

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

Si `through` es un modelo, ese modelo debe estar incluido en `models` para que `sync()` cree su tabla. Seq usa su `tableName` real y no genera una tabla intermedia automatica adicional.

```js
const UserRole = seq.define('UserRole', {
  userId: { type: DataTypes.INTEGER, allowNull: false },
  roleId: { type: DataTypes.INTEGER, allowNull: false }
}, {
  tableName: 'users_roles',
  timestamps: false
});

User.belongsToMany(Role, {
  through: UserRole,
  foreignKey: 'userId',
  otherKey: 'roleId',
  as: 'roles'
});
```

Tambien se puede pasar un objeto de include:

```js
await Role.findAll({
  include: [{
    model: Permission,
    where: { name: 'read' },
    attributes: ['id', 'name'],
    required: true
  }],
  eager: true
});
```

`attributes` limita los campos del modelo incluido y `required: true` elimina los registros padre sin coincidencias. `limit` y `offset` siempre se aplican a los registros padre, incluso cuando el include eager usa joins. Para asociar dos veces el mismo modelo, cada asociacion y cada include deben usar un `as` distinto.

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
| `findOne()`, `findAll()`, `findAndCountAll()` | `beforeFind`, `afterFind` |
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

`seq.transaction()` hace commit si el callback termina correctamente y rollback si lanza un error. Mientras exista una transaccion activa, todas las lecturas y mutaciones deben recibir exactamente su token mediante `{ transaction }`; las operaciones sin token, con un token finalizado o perteneciente a otro adapter son rechazadas. Los adapters SQLite y Map no admiten transacciones anidadas ni concurrentes sobre la misma instancia.

## Sincronizacion

```js
await seq.authenticate();
await seq.sync();
await seq.sync({ alter: true });
await seq.sync({ force: true });
```

`alter: true` es aditivo: agrega columnas, indices y restricciones soportadas, pero no elimina columnas ni datos. SQLite no puede agregar una FK a una tabla existente sin reconstruirla, por lo que esa operacion devuelve un error explicito en lugar de informar una alteracion que no ocurrio.

`authenticate()` valida que el adapter pueda conectarse a la fuente de datos. En SQLite abre la conexion si hace falta y ejecuta una consulta liviana (`SELECT 1`).

Si la instancia todavia no fue inicializada, `authenticate()` tambien ejecuta `init()` internamente. Eso registra los modelos configurados, resuelve nombres de tablas y aplica asociaciones. `init()` es idempotente, por lo que llamarlo despues de `authenticate()` no vuelve a registrar modelos.

Tambien se puede usar `init()` directamente cuando no se necesita la consulta de autenticacion:

```js
await seq.init();
await seq.sync();
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
