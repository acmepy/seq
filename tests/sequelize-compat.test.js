import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Seq, DataTypes, ValidationError } from '../src/index.js';
import { cleanupTestContext, createTestAdapter, testTable } from './shared/test-context.js';

describe('Sequelize-style compatibility', () => {
  it('defines models with seq.define and runs associate(models)', async () => {
    const adapter = createTestAdapter();
    const seq = new Seq({
      adapter,
      logging: false
    });

    const roles = seq.define('roles', {
      id: { type: DataTypes.INTEGER, primaryKey: true },
      nombre: { type: DataTypes.STRING(50), allowNull: false }
    }, {
      timestamps: false,
      tableName: testTable('roles')
    });

    const sessions = seq.define('sessions', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      usuarioId: { type: DataTypes.STRING, allowNull: false }
    }, {
      timestamps: false,
      tableName: testTable('sessions')
    });

    const usuarios = seq.define('usuarios', {
      id: { type: DataTypes.STRING, primaryKey: true },
      usuario: { type: DataTypes.STRING(20), allowNull: false, unique: true, validate: { len: [3, 20] } },
      clave: { type: DataTypes.STRING, allowNull: false, validate: { len: [6, 20] } },
      nombre: { type: DataTypes.STRING, allowNull: false, validate: { len: [3, 100] } },
      correo: { type: DataTypes.STRING, allowNull: false, validate: { isEmail: true } },
      rolId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'roles', key: 'id' } },
      activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    }, {
      timestamps: false,
      tableName: testTable('rep_usuarios'),
      labels: {
        usuario: 'Usuario',
        correo: 'Correo'
      }
    });

    usuarios.associate = (models) => {
      usuarios.hasMany(models.sessions, { foreignKey: 'usuarioId' });
      usuarios.belongsTo(models.roles, { foreignKey: 'rolId' });
    };
    usuarios.list = async () => await usuarios.findAll({ attributes: ['id', 'nombre'] });
    Object.setPrototypeOf(usuarios, {
      label() {
        return this.options.labels.usuario;
      }
    });

    try {
      await seq.init();
      await seq.sync();

      assert.equal(usuarios.label(), 'Usuario');
      assert.equal(seq.models.usuarios, usuarios);
      assert.equal(seq.models[usuarios.tableName], usuarios);
      assert.equal(usuarios.associations.sessions.type, 'hasMany');
      assert.equal(usuarios.associations.roles.type, 'belongsTo');
      assert.equal(usuarios.options.labels.usuario, 'Usuario');

      await roles.create({ id: 1, nombre: 'Admin' });
      const user = await usuarios.create({
        id: 'u1',
        usuario: 'ana',
        clave: 'secret1',
        nombre: 'Ana Demo',
        correo: 'ana@example.com',
        rolId: 1
      });

      assert.equal(user.get('activo'), true);
      assert.equal(user.get('activo'), user.getDataValue('activo'));
      assert.equal(user.get('id'), 'u1');
      assert.deepEqual(user.get(), {
        id: 'u1',
        usuario: 'ana',
        clave: 'secret1',
        nombre: 'Ana Demo',
        correo: 'ana@example.com',
        rolId: 1,
        activo: true
      });
      const list = await usuarios.list();
      assert.equal(list.length, 1);
      assert.deepEqual(list[0].toJSON(), { id: 'u1', nombre: 'Ana Demo' });
    } finally {
      await cleanupTestContext({ seq, adapter, models: [roles, sessions, usuarios] });
    }
  });

  it('applies common Sequelize validate rules', async () => {
    const adapter = createTestAdapter();
    const seq = new Seq({
      adapter,
      logging: false
    });

    const usuarios = seq.define('usuarios', {
      id: { type: DataTypes.STRING, primaryKey: true },
      usuario: { type: DataTypes.STRING(20), allowNull: false, validate: { len: [3, 20] } },
      correo: { type: DataTypes.STRING, allowNull: false, validate: { isEmail: true } }
    }, {
      timestamps: false,
      tableName: testTable('rep_usuarios')
    });

    try {
      await seq.init();
      await seq.sync();

      await assert.rejects(
        () => usuarios.create({ id: 'u1', usuario: 'ab', correo: 'ana@example.com' }),
        error => error instanceof ValidationError && error.code === 'SEQ_VALIDATION_LEN'
      );

      await assert.rejects(
        () => usuarios.create({ id: 'u2', usuario: 'ana', correo: 'correo-malo' }),
        error => error instanceof ValidationError && error.code === 'SEQ_VALIDATION_EMAIL'
      );
    } finally {
      await cleanupTestContext({ seq, adapter, models: [usuarios] });
    }
  });
});
