import { Test } from '@nestjs/testing';
import { ContractError, validManifests, invalidManifestCases } from '@mymozhem/sdk';
import { AppRegistryService } from './app-registry.service';
import { AppRegistryModule } from './app-registry.module';

describe('AppRegistryService', () => {
  it('builds its registry from the injected manifests', () => {
    const { appId, manifestVersion } = validManifests[0];
    const svc = new AppRegistryService([validManifests[0]]);
    expect(svc.getManifest(appId, manifestVersion)).toEqual(validManifests[0]);
  });

  it('fails construction (boot) when an injected manifest is invalid', () => {
    expect(() => new AppRegistryService([invalidManifestCases[0].value])).toThrow(ContractError);
  });
});

describe('AppRegistryModule', () => {
  it('provides AppRegistryService with an empty registry by default', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppRegistryModule],
    }).compile();
    const svc = moduleRef.get(AppRegistryService);
    const { appId, manifestVersion } = validManifests[0];
    expect(svc.getManifest(appId, manifestVersion)).toBeUndefined();
  });
});
