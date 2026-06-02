import { describe, it, expect } from 'vitest';
import { rtlIsolate, ltrIsolate, autoIsolate } from './bidi';

const LRI = '⁦';
const RLI = '⁧';
const FSI = '⁨';
const PDI = '⁩';

describe('rtlIsolate', () => {
  it('wraps the string in RLI … PDI and nothing else', () => {
    expect(rtlIsolate('أذكار الصباح 🌅')).toBe(`${RLI}أذكار الصباح 🌅${PDI}`);
  });

  it('adds exactly two code points (well under Telegram limits)', () => {
    const wrapped = rtlIsolate('x');
    expect([...wrapped]).toHaveLength(3);
    expect(wrapped.startsWith(RLI)).toBe(true);
    expect(wrapped.endsWith(PDI)).toBe(true);
  });

  it('preserves the original text verbatim between the marks', () => {
    const original = 'ورد القرآن (ولو صفحة) 🔖';
    expect(rtlIsolate(original).slice(1, -1)).toBe(original);
  });
});

describe('ltrIsolate', () => {
  it('wraps the string in LRI … PDI', () => {
    expect(ltrIsolate('hello')).toBe(`${LRI}hello${PDI}`);
  });
});

describe('autoIsolate', () => {
  it('wraps the string in FSI … PDI (direction inferred from content)', () => {
    expect(autoIsolate('mixed نص')).toBe(`${FSI}mixed نص${PDI}`);
  });
});
