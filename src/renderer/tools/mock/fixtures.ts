import {
  type MockRoute,
  type MockStatus,
  type PackageMock,
  PackageMockSchema,
  RouteSchema,
} from '@shared/tools/mock/contract';

export const mockRoute = (id: string, patch: Partial<MockRoute> = {}): MockRoute => ({
  ...RouteSchema.parse({ id, method: 'GET', path: '/users/:id' }),
  ...patch,
});

export const mockConfig = (patch: Partial<PackageMock> = {}): PackageMock => ({
  ...PackageMockSchema.parse({}),
  ...patch,
});

export const mockStatus = (patch: Partial<MockStatus> = {}): MockStatus => ({
  running: false,
  port: null,
  url: null,
  configChanged: false,
  requests: 0,
  ...patch,
});
