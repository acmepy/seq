import { IntegerType } from './IntegerType.js';
import { DecimalType } from './DecimalType.js';
import { NumberType } from './NumberType.js';
import { StringType } from './StringType.js';
import { BooleanType } from './BooleanType.js';
import { DateType } from './DateType.js';
import { ArrayType } from './ArrayType.js';
import { ObjectType } from './ObjectType.js';
import { JSONType } from './JSONType.js';
import { VirtualType } from './VirtualType.js';

/**
 * Factory object exposing all available data types.
 * Usage: DataTypes.INTEGER, DataTypes.STRING(100), DataTypes.DECIMAL(12, 2)
 */
const STRING = (length) => new StringType(length);
STRING._defaultType = () => new StringType();

const VIRTUAL = (returnType, fields) => new VirtualType(returnType, fields);
VIRTUAL._defaultType = () => new VirtualType();

export const DataTypes = {
  INTEGER: new IntegerType(),
  DECIMAL(precision, scale) {
    return new DecimalType(precision, scale);
  },
  NUMBER(precision, scale) {
    return new NumberType(precision, scale);
  },
  STRING,
  BOOLEAN: new BooleanType(),
  DATE: new DateType(),
  ARRAY(itemType) {
    return new ArrayType(itemType);
  },
  OBJECT: new ObjectType(),
  JSON: new JSONType(),
  VIRTUAL
};

DataTypes._INTEGER = new IntegerType();
DataTypes._BOOLEAN = new BooleanType();
DataTypes._DATE = new DateType();
DataTypes._OBJECT = new ObjectType();
DataTypes._JSON = new JSONType();
DataTypes._VIRTUAL = new VirtualType();
