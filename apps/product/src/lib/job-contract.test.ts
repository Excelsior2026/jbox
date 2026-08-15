import { describe, expect, it } from 'vitest';
import { JOB_LIMITS, validateJobInput } from '@/lib/job-contract';

describe('validateJobInput', () => {
  it('accepts a valid job', () => {
    const result = validateJobInput({ title: 'Panel replacement', notes: 'Third floor' });
    expect(result).toEqual({
      ok: true,
      value: { title: 'Panel replacement', notes: 'Third floor' },
    });
  });

  it('trims surrounding whitespace', () => {
    const result = validateJobInput({ title: '  Rewire  ', notes: '  ' });
    expect(result).toEqual({
      ok: true,
      value: { title: 'Rewire', notes: '' },
    });
  });

  it('rejects non-objects', () => {
    for (const value of [null, undefined, 'job', 4, ['title']]) {
      expect(validateJobInput(value)).toEqual({
        ok: false,
        error: 'Job must be an object.',
        field: null,
      });
    }
  });

  it('rejects non-string fields before any length check', () => {
    expect(validateJobInput({ title: {}, notes: 'x' })).toEqual({
      ok: false,
      error: 'Title must be text.',
      field: 'title',
    });
  });

  it('requires a non-blank title', () => {
    const result = validateJobInput({ title: '   ', notes: 'x' });
    expect(result).toEqual({
      ok: false,
      error: 'Title is required.',
      field: 'title',
    });
  });

  it('enforces the title length limits', () => {
    const tooShort = validateJobInput({ title: 'A', notes: '' });
    expect(tooShort).toEqual({
      ok: false,
      error: `Title must be between ${JOB_LIMITS.title.min} and ${JOB_LIMITS.title.max} characters.`,
      field: 'title',
    });

    const tooLong = validateJobInput({ title: 'x'.repeat(JOB_LIMITS.title.max + 1), notes: '' });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.ok ? null : tooLong.field).toBe('title');
  });

  it('enforces the notes length limit', () => {
    const result = validateJobInput({
      title: 'Rewire',
      notes: 'x'.repeat(JOB_LIMITS.notes.max + 1),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.field).toBe('notes');
  });

  it('allows a blank notes field', () => {
    const result = validateJobInput({ title: 'Rewire', notes: '' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.notes).toBe('');
  });
});
