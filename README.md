# seq

A minimal, modular ORM inspired by Sequelize, designed initially for Oracle.

The name `seq` refers to Oracle sequences. In this first stage, seq works entirely in memory using Map collections.

## Installation

```bash
npm install
```

## Usage

```js
import { Seq, Model, DataTypes, MapAdapter } from './src/index.js';

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
          allowNull: false
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
        tableName: 'users',
        timestamps: true
      }
    );
  }
}

const seq = new Seq({
  adapter: new MapAdapter(),
  models: [User],
  logging: console.log
});

await seq.init();
await seq.sync();

const user = await User.create({ name: 'Ana', email: 'ana@test.com' });
console.log(user.toJSON());

await seq.close();
```

## Data Types

| Type | Example | Description |
|------|---------|-------------|
| `INTEGER` | `DataTypes.INTEGER` | Integer numbers |
| `DECIMAL(p, s)` | `DataTypes.DECIMAL(12, 2)` | Decimal with precision and scale |
| `NUMBER(p, s)` | `DataTypes.NUMBER(10, 0)` | Numeric with precision and scale |
| `STRING(len)` | `DataTypes.STRING(100)` | String with max length |
| `BOOLEAN` | `DataTypes.BOOLEAN` | Boolean values |
| `DATE` | `DataTypes.DATE` | Date instances |

## Model Options

```js
Model.init(attributes, {
  seq,           // Seq instance
  modelName,     // Model name
  tableName,     // Table name
  timestamps,    // true/false (default: true)
  createdAt,     // Custom createdAt field name
  updatedAt      // Custom updatedAt field name
});
```

## Attribute Options

```js
{
  type,           // DataTypes type (required)
  primaryKey,     // Boolean
  autoIncrement,  // Boolean
  allowNull,      // Boolean (default: true)
  defaultValue,   // Value or function
  unique,         // Boolean
  field           // Custom field name
}
```

## CRUD Operations

```js
// Create
const user = await User.create({ name: 'Ana', email: 'ana@test.com' });

// Read
const found = await User.findByPk(1);
const one = await User.findOne({ where: { name: 'Ana' } });
const all = await User.findAll({ where: { active: true }, limit: 10 });
const count = await User.count();

// Update
await User.update({ balance: 200 }, { where: { name: 'Ana' } });
await user.update({ balance: 300 });

// Delete
await User.destroy({ where: { name: 'Ana' } });
await user.destroy();
await User.truncate();
```

## Transactions

```js
await seq.transaction(async (t) => {
  await User.create({ name: 'Ana', balance: 100 }, { transaction: t });
});
```

## Creating a Custom Adapter

Extend `BaseAdapter` and implement `ddl`, `dml`, `dcl`, and `tcl` groups:

```js
import { BaseAdapter } from 'seq';

class MyAdapter extends BaseAdapter {
  constructor(options) {
    super(options);
    this.ddl = new MyDDL(this);
    this.dml = new MyDML(this);
    this.dcl = new MyDCL(this);
    this.tcl = new MyTCL(this);
  }
}
```

## Architecture

```
Model -> Adapter -> Statement Group -> Implementation
```

- `Model` never knows the internal structure of the adapter
- Core never operates directly on Map
- DDL/DML/DCL/TCL are clearly separated
- Data types are abstract and converted by adapters
- All methods are async for future database compatibility

## Current Limitations

- In-memory storage only (no real databases)
- No SQL generation
- No associations or relationships
- No composite primary keys
- No indexes
- No hooks or scopes
- No migrations
- No advanced operators (Op.like, Op.in, etc.)
- No DCL support (grant/revoke)
- No connection pooling

## Running

```bash
npm install
npm test
npm run example
```

## Next Steps

- Oracle adapter
- MySQL adapter
- PostgreSQL adapter
- SQL generation
- Associations (belongsTo, hasMany, belongsToMany)
- Advanced operators
- Hooks
- Scopes
- Migrations
