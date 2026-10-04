import type {
  EntryDetail,
  EntrySummary,
  InspectorStatus,
  PackageInspector,
} from '@shared/tools/inspector/contract';

export const summary = (id: string, patch: Partial<EntrySummary> = {}): EntrySummary => ({
  id,
  at: Date.UTC(2026, 9, 4, 10, 0, 0),
  method: 'GET',
  path: '/users/1',
  status: 200,
  ms: 12,
  reqBytes: 0,
  resBytes: 20,
  replayOf: null,
  error: null,
  ...patch,
});

export const detail = (s: EntrySummary): EntryDetail => ({
  summary: s,
  request: {
    headers: [
      { name: 'Host', value: 'localhost:4020', masked: false },
      { name: 'Authorization', value: '••••••', masked: true },
      { name: 'Accept', value: 'application/json', masked: false },
    ],
    body: {
      kind: 'text',
      text: '{"name":"Ada"}',
      truncated: false,
      contentType: 'application/json',
    },
  },
  response: {
    headers: [{ name: 'Content-Type', value: 'application/json', masked: false }],
    body: {
      kind: 'text',
      text: '{"id":1,"ok":true}',
      truncated: false,
      contentType: 'application/json',
    },
  },
});

export const inspectorStatus = (patch: Partial<InspectorStatus> = {}): InspectorStatus => ({
  running: false,
  port: null,
  url: null,
  target: 'http://localhost:3000',
  targetSource: 'env',
  configChanged: false,
  count: 0,
  ...patch,
});

export const inspectorConfig = (patch: Partial<PackageInspector> = {}): PackageInspector => ({
  port: null,
  target: null,
  ...patch,
});
