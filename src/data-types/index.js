import { IntegerType } from './IntegerType.js';
import { DecimalType } from './DecimalType.js';
import { NumberType } from './NumberType.js';
import { StringType } from './StringType.js';
import { BooleanType } from './BooleanType.js';
import { DateType } from './DateType.js';

/**
 * Factory object exposing all available data types.
 * Usage: DataTypes.INTEGER, DataTypes.STRING(100), DataTypes.DECIMAL(12, 2)
 */
export const DataTypes = {
  INTEGER: new IntegerType(),
  DECIMAL(precision, scale) {
    return new DecimalType(precision, scale);
  },
  NUMBER(precision, scale) {
    return new NumberType(precision, scale);
  },
  STRING(length) {
    return new StringType(length);
  },
  BOOLEAN: new BooleanType(),
  DATE: new DateType()
};

// Pre-create common instances for direct access
DataTypes._INTEGER = new IntegerType();
DataTypes._BOOLEAN = new BooleanType();
DataTypes._DATE = new DateType();
