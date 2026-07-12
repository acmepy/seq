import {
  Seq,
  Model,
  DataTypes,
  MapAdapter
} from '../src/index.js';

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
        },
        tags: {
          type: DataTypes.ARRAY(DataTypes.STRING(50)),
          allowNull: true,
          defaultValue: () => []
        },
        settings: {
          type: DataTypes.OBJECT,
          allowNull: true,
          defaultValue: () => ({})
        },
        metadata: {
          type: DataTypes.JSON,
          allowNull: true,
          defaultValue: () => ({})
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

const syncResult = await seq.sync();
console.log('Sync:', syncResult);

const ana = await User.create({
  name: 'Ana',
  email: 'ana@example.com',
  balance: 150.50,
  tags: ['admin', 'dev'],
  settings: { theme: 'dark', lang: 'es' },
  metadata: { loginCount: 5, lastIp: '192.168.1.1' }
});

await User.create({ name: 'Juan', email: 'juan@example.com', tags: ['user'], metadata: { loginCount: 1 }});

console.log( 'Usuarios:', (await User.findAll()).map(u => u.toJSON()) );

await ana.update({ balance: 200, tags: ['admin', 'dev', 'ops'], metadata: { loginCount: 6, lastIp: '10.0.0.1' } });

console.log( 'Ana actualizada:', ana.toJSON() );

await User.destroy({ where: { name: 'Juan' } });

console.log( 'Resultado final:', (await User.findAll()).map(u => u.toJSON()) );

await seq.close();
