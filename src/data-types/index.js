import { IntegerType } from './IntegerType.js';
import { DecimalType } from './DecimalType.js';
import { NumberType } from './NumberType.js';
import { StringType } from './StringType.js';
import { BooleanType } from './BooleanType.js';
import { DateType } from './DateType.js';
import { ArrayType } from './ArrayType.js';
import { ObjectType } from './ObjectType.js';
import { JSONType } from './JSONType.js';

/**
 * Factory object exposing all available data types.
 * Usage: DataTypes.INTEGER, DataTypes.STRING(100), DataTypes.DECIMAL(12, 2)
 */
const STRING = (length) => new StringType(length);
STRING._defaultType = () => new StringType();

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
  JSON: new JSONType()
};

DataTypes._INTEGER = new IntegerType();
DataTypes._BOOLEAN = new BooleanType();
DataTypes._DATE = new DateType();
DataTypes._OBJECT = new ObjectType();
DataTypes._JSON = new JSONType();
