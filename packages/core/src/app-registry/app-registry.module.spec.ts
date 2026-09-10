import { Test } from '@nestjs/testing';
import { AppRegistryModule } from './app-registry.module';
import { AppRegistryService } from './app-registry.service';

describe('AppRegistryModule.register', () => {
  it('provides the registry from composition-root manifests', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppRegistryModule.register([])] }).compile();
    expect(moduleRef.get(AppRegistryService)).toBeInstanceOf(AppRegistryService);
  });

  it('fails closed on an invalid manifest at boot', async () => {
    await expect(
      Test.createTestingModule({ imports: [AppRegistryModule.register([{ appId: 'core' }])] }).compile(),
    ).rejects.toThrow();
  });
});
