/** 自動バックアップの入れ物の検証（T-18、仕様書 §9.2）。 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadNetworkDef, type NetworkIndex } from '@/domain/network';
import { createProject } from './create';
import { loadProjectData } from './load';
import { BACKUP_FORMAT, parseBackup, serializeBackup } from './backup';

const routeJsonPath = fileURLToPath(new URL('../../../data/route.json', import.meta.url));
const loaded = loadNetworkDef(readFileSync(routeJsonPath, 'utf8'));
if (!loaded.ok) throw new Error('route.json を読み込めません');
const network: NetworkIndex = loaded.network;

const SAVED_AT = new Date('2026-07-26T12:34:56.000Z');
const project = createProject(network, { name: '2026年度', now: SAVED_AT });

describe('書き出し', () => {
  it('目印・時刻・ファイル名・中身を持つ', () => {
    const parsed = parseBackup(serializeBackup(project, 'a.uodia', SAVED_AT));
    expect(parsed.ok && parsed.envelope).toMatchObject({
      format: BACKUP_FORMAT,
      savedAt: '2026-07-26T12:34:56.000Z',
      fileName: 'a.uodia',
    });
  });

  it('保存していないプロジェクトはファイル名を持たない', () => {
    const parsed = parseBackup(serializeBackup(project, null, SAVED_AT));
    expect(parsed.ok && parsed.envelope.fileName).toBeNull();
  });

  it('**書き出して読み戻すと元のプロジェクトに戻る**', () => {
    const parsed = parseBackup(serializeBackup(project, null, SAVED_AT));
    if (!parsed.ok) throw new Error('読めませんでした');

    const restored = loadProjectData(parsed.envelope.project, network);
    expect(restored.ok && restored.project).toEqual(project);
    expect(restored.ok && restored.warnings).toEqual([]);
  });

  it('時刻を渡さなければ現在時刻を使う', () => {
    const parsed = parseBackup(serializeBackup(project, null));
    expect(parsed.ok && Date.parse(parsed.envelope.savedAt)).toBeGreaterThan(0);
  });
});

describe('読み込み', () => {
  it('JSON として読めなければ断る', () => {
    const parsed = parseBackup('{ 壊れている');
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.message).toContain('読めません');
  });

  it('**目印が無いものは受け付けない**（他の JSON を読み違えない）', () => {
    const parsed = parseBackup(JSON.stringify({ savedAt: '2026-07-26T12:00:00.000Z' }));
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.message).toContain('形式が違います');
  });

  it('時刻が時刻として読めなければ受け付けない', () => {
    const parsed = parseBackup(
      JSON.stringify({ format: BACKUP_FORMAT, savedAt: 'きのう', fileName: null, project: {} }),
    );
    expect(parsed.ok).toBe(false);
  });

  it('中身の形は検査しない（読込の手順に任せる）', () => {
    const parsed = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        savedAt: SAVED_AT.toISOString(),
        fileName: null,
        project: { でたらめ: true },
      }),
    );
    expect(parsed.ok).toBe(true);
    // 形が違うことは読込の段階で分かる。
    expect(parsed.ok && loadProjectData(parsed.envelope.project, network).ok).toBe(false);
  });
});
