import { describe, expect, it } from 'vitest';
import {
  capabilitiesForRole,
  PLATFORM_MODULES,
  resolveModulePrerequisites,
  unsatisfiedPrerequisites,
  type ModuleKey,
} from './index';

describe('role capabilities', () => {
  it('does not grant a technician the ability to schedule work', () => {
    expect(capabilitiesForRole('technician').has('jobs.schedule')).toBe(false);
    expect(capabilitiesForRole('office').has('jobs.schedule')).toBe(true);
  });

  it('reserves publishing prices to the owner', () => {
    expect(capabilitiesForRole('owner').has('price_book.publish')).toBe(true);
    expect(capabilitiesForRole('office').has('price_book.publish')).toBe(false);
  });
});

describe('resolveModulePrerequisites', () => {
  it('pulls in inventory when replenishment is purchased alone', () => {
    const resolved = resolveModulePrerequisites(['replenishment']);

    expect([...resolved].sort()).toEqual(['inventory', 'replenishment']);
  });

  it('leaves a module with no prerequisites untouched', () => {
    expect([...resolveModulePrerequisites(['scheduling'])]).toEqual(['scheduling']);
  });

  it('does not duplicate a prerequisite that was also purchased directly', () => {
    const resolved = resolveModulePrerequisites(['inventory', 'replenishment']);

    expect([...resolved].sort()).toEqual(['inventory', 'replenishment']);
  });
});

describe('unsatisfiedPrerequisites', () => {
  it('reports replenishment as unusable without inventory', () => {
    const gaps = unsatisfiedPrerequisites(new Set<ModuleKey>(['replenishment']));

    expect(gaps.get('replenishment')).toEqual(['inventory']);
  });

  it('reports nothing when every prerequisite is present', () => {
    const gaps = unsatisfiedPrerequisites(new Set<ModuleKey>(['inventory', 'replenishment']));

    expect(gaps.size).toBe(0);
  });
});

describe('module catalog', () => {
  it('only names prerequisites that exist in the catalog', () => {
    const keys = new Set(PLATFORM_MODULES.map((module) => module.key));

    for (const module of PLATFORM_MODULES) {
      for (const required of module.requires) {
        expect(keys.has(required)).toBe(true);
      }
    }
  });
});
