process.env.SEQ_TEST_ADAPTER = 'oracle26';
await import('../oracle26-adapter.test.js');
await import('./oracle-suite.test.js');
