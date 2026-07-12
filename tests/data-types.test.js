import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DataTypes } from '../src/data-types/index.js';
import { AbstractDataType } from '../src/data-types/AbstractDataType.js';
import { IntegerType } from '../src/data-types/IntegerType.js';
import { DecimalType } from '../src/data-types/DecimalType.js';
import { StringType } from '../src/data-types/StringType.js';
import { BooleanType } from '../src/data-types/BooleanType.js';
import { DateType } from '../src/data-types/DateType.js';

describe('DataTypes', () => {
  describe('AbstractDataType', () => {
    it('is a class', () => {
      assert.equal(typeof AbstractDataType, 'function');
    });

    it('stores key and options', () => {
      const type = new AbstractDataType('TEST', { foo: 'bar' });
      assert.equal(type.key, 'TEST');
      assert.deepEqual(type.options, { foo: 'bar' });
    });

    it('toString returns key with options', () => {
      const type = new AbstractDataType('TEST', { a: 1, b: 2 });
      assert.equal(type.toString(), 'TEST(1, 2)');
    });

    it('toString returns key only when no options', () => {
      const type = new AbstractDataType('TEST');
      assert.equal(type.toString(), 'TEST');
    });
  });

  describe('INTEGER', () => {
    it('is an instance of AbstractDataType', () => {
      assert.ok(DataTypes.INTEGER instanceof AbstractDataType);
    });

    it('has key INTEGER', () => {
      assert.equal(DataTypes.INTEGER.key, 'INTEGER');
    });

    it('toString returns INTEGER', () => {
      assert.equal(DataTypes.INTEGER.toString(), 'INTEGER');
    });

    it('accepts valid integers', () => {
      assert.ok(DataTypes.INTEGER.validate(0).valid);
      assert.ok(DataTypes.INTEGER.validate(42).valid);
      assert.ok(DataTypes.INTEGER.validate(-100).valid);
    });

    it('rejects decimals', () => {
      assert.ok(!DataTypes.INTEGER.validate(3.14).valid);
    });

    it('rejects strings', () => {
      assert.ok(!DataTypes.INTEGER.validate('hello').valid);
    });

    it('accepts null', () => {
      assert.ok(DataTypes.INTEGER.validate(null).valid);
    });
  });

  describe('DECIMAL', () => {
    it('creates a DecimalType with default precision and scale', () => {
      const type = DataTypes.DECIMAL();
      assert.ok(type instanceof DecimalType);
      assert.equal(type.key, 'DECIMAL');
      assert.equal(type.options.precision, 10);
      assert.equal(type.options.scale, 2);
    });

    it('creates a DecimalType with custom precision and scale', () => {
      const type = DataTypes.DECIMAL(12, 4);
      assert.equal(type.options.precision, 12);
      assert.equal(type.options.scale, 4);
    });

    it('toString includes precision and scale', () => {
      const type = DataTypes.DECIMAL(12, 2);
      assert.equal(type.toString(), 'DECIMAL(12, 2)');
    });

    it('accepts valid numbers', () => {
      const type = DataTypes.DECIMAL(10, 2);
      assert.ok(type.validate(0).valid);
      assert.ok(type.validate(3.14).valid);
      assert.ok(type.validate(-100.5).valid);
    });

    it('rejects non-numbers', () => {
      const type = DataTypes.DECIMAL(10, 2);
      assert.ok(!type.validate('hello').valid);
      assert.ok(!type.validate(NaN).valid);
    });

    it('accepts null', () => {
      const type = DataTypes.DECIMAL(10, 2);
      assert.ok(type.validate(null).valid);
    });
  });

  describe('NUMBER', () => {
    it('creates a NumberType', () => {
      const type = DataTypes.NUMBER(12, 4);
      assert.ok(type instanceof AbstractDataType);
      assert.equal(type.key, 'NUMBER');
      assert.equal(type.options.precision, 12);
      assert.equal(type.options.scale, 4);
    });

    it('defaults to precision 10, scale 0', () => {
      const type = DataTypes.NUMBER();
      assert.equal(type.options.precision, 10);
      assert.equal(type.options.scale, 0);
    });

    it('accepts valid numbers', () => {
      assert.ok(DataTypes.NUMBER().validate(42).valid);
      assert.ok(DataTypes.NUMBER().validate(0).valid);
    });

    it('rejects non-numbers', () => {
      assert.ok(!DataTypes.NUMBER().validate('abc').valid);
    });
  });

  describe('STRING', () => {
    it('creates a StringType with default length 255', () => {
      const type = DataTypes.STRING();
      assert.ok(type instanceof StringType);
      assert.equal(type.key, 'STRING');
      assert.equal(type.options.length, 255);
    });

    it('creates a StringType with custom length', () => {
      const type = DataTypes.STRING(100);
      assert.equal(type.options.length, 100);
    });

    it('toString includes length', () => {
      const type = DataTypes.STRING(100);
      assert.equal(type.toString(), 'STRING(100)');
    });

    it('accepts valid strings within length', () => {
      const type = DataTypes.STRING(10);
      assert.ok(type.validate('hello').valid);
      assert.ok(type.validate('').valid);
      assert.ok(type.validate('1234567890').valid);
    });

    it('rejects strings exceeding length', () => {
      const type = DataTypes.STRING(10);
      const result = type.validate('12345678901');
      assert.ok(!result.valid);
      assert.ok(result.message.includes('11'));
      assert.ok(result.message.includes('10'));
    });

    it('rejects non-strings', () => {
      const type = DataTypes.STRING(10);
      assert.ok(!type.validate(123).valid);
    });

    it('accepts null', () => {
      const type = DataTypes.STRING(10);
      assert.ok(type.validate(null).valid);
    });
  });

  describe('BOOLEAN', () => {
    it('is an instance of AbstractDataType', () => {
      assert.ok(DataTypes.BOOLEAN instanceof BooleanType);
    });

    it('has key BOOLEAN', () => {
      assert.equal(DataTypes.BOOLEAN.key, 'BOOLEAN');
    });

    it('accepts true and false', () => {
      assert.ok(DataTypes.BOOLEAN.validate(true).valid);
      assert.ok(DataTypes.BOOLEAN.validate(false).valid);
    });

    it('rejects non-booleans', () => {
      assert.ok(!DataTypes.BOOLEAN.validate(0).valid);
      assert.ok(!DataTypes.BOOLEAN.validate(1).valid);
      assert.ok(!DataTypes.BOOLEAN.validate('true').valid);
    });

    it('accepts null', () => {
      assert.ok(DataTypes.BOOLEAN.validate(null).valid);
    });
  });

  describe('DATE', () => {
    it('is an instance of AbstractDataType', () => {
      assert.ok(DataTypes.DATE instanceof DateType);
    });

    it('has key DATE', () => {
      assert.equal(DataTypes.DATE.key, 'DATE');
    });

    it('accepts valid Date instances', () => {
      assert.ok(DataTypes.DATE.validate(new Date()).valid);
      assert.ok(DataTypes.DATE.validate(new Date('2024-01-01')).valid);
    });

    it('rejects invalid Date instances', () => {
      assert.ok(!DataTypes.DATE.validate(new Date('invalid')).valid);
    });

    it('rejects non-Date values', () => {
      assert.ok(!DataTypes.DATE.validate('2024-01-01').valid);
      assert.ok(!DataTypes.DATE.validate(1234567890).valid);
    });

    it('accepts null', () => {
      assert.ok(DataTypes.DATE.validate(null).valid);
    });
  });
});
