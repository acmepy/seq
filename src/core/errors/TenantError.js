import { SeqError } from './SeqError.js';

export class TenantError extends SeqError {
  constructor(message, options = {}) {
    super(message, { code: 'SEQ_TENANT_ERROR', ...options });
    this.name = 'TenantError';
  }
}
