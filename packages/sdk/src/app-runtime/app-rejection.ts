import { ContractError } from '../errors/error-codes';
import type { ContractErrorCode } from '../errors/error-codes';

// Типизированный отказ модуля; код обязан быть в CONTRACT_ERROR_CODES.
export class AppRejection extends ContractError {
  constructor(code: ContractErrorCode, message: string) {
    super(code, message);
    this.name = 'AppRejection';
  }
}
