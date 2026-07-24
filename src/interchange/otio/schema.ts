// Builders for OpenTimelineIO JSON (schema strings verified against otio 0.18.1).
import type { FrameRate } from '../../document/types';

export const rateOf = (fr: FrameRate): number => fr.num / fr.den;

export const RationalTime = (value: number, rate: number) => ({
  OTIO_SCHEMA: 'RationalTime.1', rate, value,
});

export const TimeRange = (start: number, duration: number, rate: number) => ({
  OTIO_SCHEMA: 'TimeRange.1',
  duration: RationalTime(duration, rate),
  start_time: RationalTime(start, rate),
});

export type OtioObject = Record<string, any>;
