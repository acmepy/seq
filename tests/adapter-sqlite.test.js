import { Seq, SQLiteAdapter } from '../src/index.js';
import { runAdapterSuite } from './shared/adapter-suite.js';

runAdapterSuite({
  name: 'SQLite',
  createSeq({ models }) {
    const adapter = new SQLiteAdapter({ database: ':memory:' });
    const seq = new Seq({ adapter, models, logging: false });
    return { seq, adapter };
  }
});
