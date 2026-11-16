import { testConfig } from '../../test/helpers';
import { MarketCalendarService } from './market-calendar.service';

// Default settings: New York, 09:30 to 16:00. In November New York is UTC-5.
const calendar = new MarketCalendarService(testConfig());
const at = (iso: string) => calendar.getExecutionSchedule(new Date(iso));

describe('MarketCalendarService', () => {
  it('executes now when the market is open (Wednesday 10:00 New York)', () => {
    const schedule = at('2026-11-11T15:00:00Z');
    expect(schedule.marketOpenNow).toBe(true);
    expect(schedule.executeAt).toBe('2026-11-11T15:00:00.000Z');
    expect(schedule.timezone).toBe('America/New_York');
  });

  it('waits for the open on the same day when it is early morning', () => {
    const schedule = at('2026-11-11T12:00:00Z'); // 07:00 New York
    expect(schedule.marketOpenNow).toBe(false);
    expect(schedule.executeAt).toBe('2026-11-11T14:30:00.000Z');
    expect(schedule.executeAtMarketTime).toBe('2026-11-11T09:30:00.000-05:00');
  });

  it('moves to the next day after the close', () => {
    expect(at('2026-11-11T22:00:00Z').executeAt).toBe(
      '2026-11-12T14:30:00.000Z',
    );
  });

  it('moves Friday evening, Saturday and Sunday to Monday morning', () => {
    const monday = '2026-11-16T14:30:00.000Z';
    expect(at('2026-11-13T22:00:00Z').executeAt).toBe(monday); // Friday 17:00
    expect(at('2026-11-14T15:00:00Z').executeAt).toBe(monday); // Saturday
    expect(at('2026-11-15T15:00:00Z').executeAt).toBe(monday); // Sunday
  });

  it('treats the open as open and the close as closed', () => {
    expect(at('2026-11-11T14:30:00Z').marketOpenNow).toBe(true);
    expect(at('2026-11-11T21:00:00Z').marketOpenNow).toBe(false);
  });

  it('handles the daylight saving change over a weekend', () => {
    // Friday 6 March 2026 after the close (UTC-5). Clocks change on Sunday 8 March.
    // Monday 09:30 New York is then 13:30 UTC, not 14:30.
    expect(at('2026-03-06T22:00:00Z').executeAt).toBe(
      '2026-03-09T13:30:00.000Z',
    );
  });

  it('follows a different market when configured', () => {
    const london = new MarketCalendarService(
      testConfig({
        market: {
          timezone: 'Europe/London',
          open: '08:00',
          close: '16:30',
          holidays: [],
        },
      }),
    );
    const schedule = london.getExecutionSchedule(
      new Date('2026-11-11T07:00:00Z'),
    );
    expect(schedule.executeAt).toBe('2026-11-11T08:00:00.000Z');
  });

  describe('holidays', () => {
    const withHolidays = (...holidays: string[]) =>
      new MarketCalendarService(
        testConfig({
          market: {
            timezone: 'America/New_York',
            open: '09:30',
            close: '16:00',
            holidays,
          },
        }),
      );

    it('is closed on a holiday, even during normal hours', () => {
      // Thursday 26 November 2026, 10:00 New York
      const schedule = withHolidays('2026-11-26').getExecutionSchedule(
        new Date('2026-11-26T15:00:00Z'),
      );
      expect(schedule.marketOpenNow).toBe(false);
      expect(schedule.executeAt).toBe('2026-11-27T14:30:00.000Z');
    });

    it('skips a holiday when looking for the next open', () => {
      // Wednesday evening, Thursday is a holiday: next open is Friday.
      const schedule = withHolidays('2026-11-26').getExecutionSchedule(
        new Date('2026-11-25T22:00:00Z'),
      );
      expect(schedule.executeAt).toBe('2026-11-27T14:30:00.000Z');
    });

    it('skips a holiday next to a weekend and several holidays in a row', () => {
      // Friday 25 December is a holiday: Thursday evening goes to Monday.
      expect(
        withHolidays('2026-12-25').getExecutionSchedule(
          new Date('2026-12-24T22:00:00Z'),
        ).executeAt,
      ).toBe('2026-12-28T14:30:00.000Z');
      // Monday and Tuesday are both holidays: Friday evening goes to Wednesday.
      expect(
        withHolidays('2026-12-28', '2026-12-29').getExecutionSchedule(
          new Date('2026-12-25T22:00:00Z'),
        ).executeAt,
      ).toBe('2026-12-30T14:30:00.000Z');
    });

    it('uses the market date, not the UTC date, to match a holiday', () => {
      // 01:00 UTC on 27 November is still 26 November (20:00) in New York.
      const schedule = withHolidays('2026-11-27').getExecutionSchedule(
        new Date('2026-11-27T01:00:00Z'),
      );
      expect(schedule.executeAt).toBe('2026-11-30T14:30:00.000Z');
    });
  });

  it('is open one second before the close and closed one millisecond before the open', () => {
    expect(at('2026-11-11T20:59:59Z').marketOpenNow).toBe(true);
    expect(at('2026-11-11T14:29:59.999Z').marketOpenNow).toBe(false);
  });

  it('uses the current time when none is passed', () => {
    expect(
      new Date(calendar.getExecutionSchedule().executeAt).getTime(),
    ).not.toBeNaN();
  });
});
