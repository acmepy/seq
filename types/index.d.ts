export type SortDirection = 'ASC' | 'DESC';
export type ForeignKeyAction = 'RESTRICT' | 'CASCADE' | 'SET NULL';
export type NamingConvention = 'camelCase' | 'snake_case';
export type CaseStyle = 'lower' | 'upper' | null;
export type ForeignKeyStrategy = 'alter' | 'inline' | 'none';

export interface Transaction {
  readonly id: number;
  active: boolean;
  readonly adapter: BaseAdapter;
}

export type WhereOptions = Record<string, unknown> & { [operator: symbol]: WhereOptions[] | unknown };

export interface AttributeReference {
  model: string;
  key?: string;
  constraintName?: string;
}

export interface AttributeValidation {
  len?: [number, number];
  isEmail?: boolean;
}

export interface AttributeDefinition {
  type: unknown;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  allowNull?: boolean;
  defaultValue?: unknown | (() => unknown);
  unique?: boolean;
  field?: string;
  references?: AttributeReference;
  onDelete?: ForeignKeyAction;
  onUpdate?: ForeignKeyAction;
  validate?: AttributeValidation;
  get?: () => unknown;
  set?: (value: unknown) => void;
}

export type AttributeMap = Record<string, AttributeDefinition>;
export type ModelStatic = typeof Model;

export interface ModelOptions {
  seq?: Seq;
  modelName?: string;
  tableName?: string;
  timestamps?: boolean;
  createdAt?: string;
  updatedAt?: string;
  hooks?: Record<string, Function | Function[]>;
  alias?: string;
}

export interface AssociationOptions {
  foreignKey?: string;
  otherKey?: string;
  as?: string;
  onDelete?: ForeignKeyAction;
  onUpdate?: ForeignKeyAction;
  constraintName?: string;
  through?: string | ModelStatic | { model: ModelStatic };
}

export type IncludeOption =
  | ModelStatic
  | {
      model: ModelStatic;
      as?: string;
      where?: Record<string, unknown>;
      required?: boolean;
      eager?: boolean;
      attributes?: string[];
    };

export interface QueryOptions {
  where?: WhereOptions;
  order?: Array<[string, SortDirection]>;
  limit?: number;
  offset?: number;
  attributes?: string[];
  include?: IncludeOption | IncludeOption[];
  eager?: boolean;
  hooks?: boolean;
  transaction?: Transaction;
}

export interface MutationOptions {
  where?: WhereOptions;
  hooks?: boolean;
  transaction?: Transaction;
}

export interface BuildOptions {
  _isNew?: boolean;
  _partial?: boolean;
}

export interface SeqOptions {
  adapter: BaseAdapter;
  models?: ModelStatic[];
  logging?: boolean | Function | Record<string, Function | false>;
  define?: ModelOptions;
  naming?: {
    tables?: NamingConvention;
    columns?: NamingConvention;
    prefix?: string;
  };
}

export interface SyncOptions {
  force?: boolean;
  alter?: boolean;
}

export interface SyncResult {
  created: string[];
  existing: string[];
  altered: string[];
  dropped: string[];
}

export class Model<TValues = Record<string, unknown>> {
  constructor(values?: Partial<TValues>, options?: BuildOptions);

  dataValues: Partial<TValues> & Record<string, unknown>;

  static init(attributes: AttributeMap, options?: ModelOptions): typeof Model;
  static define(seq: Seq): void;
  static addHook(name: string, handler: Function): typeof Model;
  static create<T extends ModelStatic>(this: T, values?: object, options?: MutationOptions): Promise<InstanceType<T>>;
  static bulkCreate<T extends ModelStatic>(this: T, records?: object[], options?: MutationOptions): Promise<Array<InstanceType<T>>>;
  static findByPk<T extends ModelStatic>(this: T, id: unknown, options?: QueryOptions): Promise<InstanceType<T> | null>;
  static findOne<T extends ModelStatic>(this: T, options?: QueryOptions): Promise<InstanceType<T> | null>;
  static findAll<T extends ModelStatic>(this: T, options?: QueryOptions): Promise<Array<InstanceType<T>>>;
  static count(options?: QueryOptions): Promise<number>;
  static findAndCountAll<T extends ModelStatic>(this: T, options?: QueryOptions): Promise<{ count: number; rows: Array<InstanceType<T>> }>;
  static update(values: object, options?: MutationOptions): Promise<Model[]>;
  static destroy(options?: MutationOptions): Promise<number>;
  static truncate(options?: MutationOptions): Promise<void>;
  static build<T extends ModelStatic>(this: T, values?: object, options?: BuildOptions): InstanceType<T>;

  getDataValue(key: string): unknown;
  setDataValue(key: string, value: unknown): void;
  get(): Partial<TValues> & Record<string, unknown>;
  toJSON(): Partial<TValues> & Record<string, unknown>;
  save(options?: MutationOptions): Promise<this>;
  update(values: Partial<TValues>, options?: MutationOptions): Promise<this>;
  destroy(options?: MutationOptions): Promise<void>;
}

export class Seq {
  constructor(options: SeqOptions);

  get adapter(): BaseAdapter;
  get models(): ModelStatic[] & Record<string, ModelStatic>;

  database(): Promise<object>;
  authenticate(): Promise<boolean>;
  init(): Promise<void>;
  registerModel(modelClass: ModelStatic): void;
  define(modelName: string, attributes: AttributeMap, options?: ModelOptions): typeof Model;
  getModel(name: string): ModelStatic | undefined;
  hasModel(name: string): boolean;
  sync(options?: SyncOptions): Promise<SyncResult>;
  transaction<TResult>(callback: (transaction: Transaction) => Promise<TResult> | TResult): Promise<TResult>;
  close(): Promise<void>;
}

export class Association {
  constructor(type: 'hasMany' | 'hasOne' | 'belongsTo' | 'belongsToMany', source: ModelStatic, target: ModelStatic, options?: AssociationOptions);
}

export class ModelRegistry {
  register(modelClass: ModelStatic): void;
  get(name: string): ModelStatic | undefined;
  has(name: string): boolean;
  all(): ModelStatic[];
  clear(): void;
}

export interface AdapterOptions {
  caseStyle?: CaseStyle;
  fkStrategy?: ForeignKeyStrategy;
  eager?: boolean;
}

export class BaseAdapter {
  constructor(options?: AdapterOptions);
  connect(): Promise<void>;
  authenticate(): Promise<boolean>;
  close(): Promise<void>;
  initialize(): Promise<void>;
  inspectDatabase(): Promise<object>;
  mapDataType(dataType: unknown): string;
  normalizeValue(attribute: AttributeDefinition, value: unknown): unknown;
  get caseStyle(): CaseStyle;
  get fkStrategy(): ForeignKeyStrategy;
  get eager(): boolean;
}

export interface SQLiteAdapterOptions extends AdapterOptions {
  database?: string;
}

export class SQLiteAdapter extends BaseAdapter {
  constructor(options?: SQLiteAdapterOptions);
}

export class MapAdapter extends BaseAdapter {
  constructor(options?: AdapterOptions);
}

export const DataTypes: Record<string, any>;
export const Op: Record<string, symbol>;

export class SeqError extends Error {
  code?: string;
  details?: unknown;
}

export class ConfigurationError extends SeqError {}
export class ModelError extends SeqError {}
export class ValidationError extends SeqError {}
export class AdapterError extends SeqError {}
