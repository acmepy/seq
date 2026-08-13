import { SeqError } from '../../core/errors/SeqError.js';

export class ErrorAbstract extends SeqError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'ErrorAbstract';
    this.code = options.code || 'SEQ_ADAPTER_ERROR';
  }
}
