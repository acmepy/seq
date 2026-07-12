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
  balance: 150.50
});

await User.create({
  name: 'Juan',
  email: 'juan@example.com'
});

console.log(
  'Usuarios:',
  (await User.findAll()).map(user => user.toJSON())
);

await ana.update({
  balance: 200
});

console.log(
  'Ana actualizada:',
  ana.toJSON()
);

await User.destroy({
  where: {
    name: 'Juan'
  }
});

console.log(
  'Resultado final:',
  (await User.findAll()).map(user => user.toJSON())
);

await seq.close();
