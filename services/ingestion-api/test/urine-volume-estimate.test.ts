import { describe, expect, it } from 'vitest';
import { estimateUrineVolume } from '../src/persistence/urine-volume-estimate.js';

describe('estimateUrineVolume', () => {
  it('applies the base formula: 10 ml per 100 ms of net pump time', () => {
    // net = 5000 - 3000 = 2000 ms -> 2000 / 100 * 10 = 200 ml
    expect(estimateUrineVolume(3000, 5000)).toEqual({
      estimatedUrineMl: 200,
      estimationStatus: 'estimated',
    });
  });

  it('rounds fractional millilitres to the nearest integer', () => {
    // net = 55 ms -> 55 / 100 * 10 = 5.5 -> 6 ml
    expect(estimateUrineVolume(0, 55)).toEqual({
      estimatedUrineMl: 6,
      estimationStatus: 'estimated',
    });
  });

  it('reports no_flow with zero volume when the pump does not exceed the flush', () => {
    expect(estimateUrineVolume(5000, 5000)).toEqual({ estimatedUrineMl: 0, estimationStatus: 'no_flow' });
    expect(estimateUrineVolume(5000, 3000)).toEqual({ estimatedUrineMl: 0, estimationStatus: 'no_flow' });
  });

  it('flags an implausibly large estimate as out_of_range while keeping the value', () => {
    // net = 30000 ms -> 3000 ml, above the 2000 ml plausibility bound
    expect(estimateUrineVolume(0, 30000)).toEqual({
      estimatedUrineMl: 3000,
      estimationStatus: 'out_of_range',
    });
  });

  it('treats a non-finite net window as no_flow rather than emitting NaN', () => {
    expect(estimateUrineVolume(Number.NaN, 5000)).toEqual({ estimatedUrineMl: 0, estimationStatus: 'no_flow' });
  });
});
