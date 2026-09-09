// ContractError напрямую: wireCodeOf gateway отдаёт err.code
// без записи в error-mapping (REQ-SEC-006 соблюдено: наружу только код).
import { ContractError } from '@mymozhem/sdk';

export class AppModuleUnavailableError extends ContractError {
  constructor(appId: string, manifestVersion: number) {
    super('MODULE_UNAVAILABLE', `no runtime module registered for ${appId}@${manifestVersion}`);
    this.name = new.target.name;
  }
}

export class PublishForbiddenError extends ContractError {
  constructor(reason: string) {
    super('PUBLISH_FORBIDDEN', reason);
    this.name = new.target.name;
  }
}
