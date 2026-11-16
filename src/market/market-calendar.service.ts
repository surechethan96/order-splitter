import { Inject, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { APP_CONFIG, type AppConfig } from '../config/app.config';

export interface ExecutionSchedule {
  // When the orders should be executed, in UTC.
  executeAt: string;
  // The same moment shown in the market's own time zone.
  executeAtMarketTime: string;
  // True when the market is open right now, so the orders can go straight away.
  marketOpenNow: boolean;
  timezone: string;
  note: string;
}

// Works out when an order can execute: open Monday to Friday between the open and close times, except on holidays.
@Injectable()
export class MarketCalendarService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  getExecutionSchedule(now: Date = new Date()): ExecutionSchedule {
    const { timezone, open, close } = this.config.market;
    const local = DateTime.fromJSDate(now, { zone: timezone });
    const openToday = this.at(local, open);
    const closeToday = this.at(local, close);

    if (this.isTradingDay(local) && local >= openToday && local < closeToday) {
      return this.schedule(local, true, 'Market is open. Execute now.');
    }

    // Before the open on a trading day: today's open. Otherwise: the next trading day's open.
    let next =
      this.isTradingDay(local) && local < openToday
        ? openToday
        : this.at(local.plus({ days: 1 }), open);
    while (!this.isTradingDay(next)) {
      next = next.plus({ days: 1 });
    }
    return this.schedule(
      next,
      false,
      'Market is closed. Execute at the next market open.',
    );
  }

  private isTradingDay(date: DateTime): boolean {
    const isWeekday = date.weekday <= 5; // luxon: Monday = 1 ... Sunday = 7
    return (
      isWeekday && !this.config.market.holidays.includes(date.toISODate()!)
    );
  }

  private at(day: DateTime, time: string): DateTime {
    const [hour, minute] = time.split(':').map(Number);
    return day.set({ hour, minute, second: 0, millisecond: 0 });
  }

  private schedule(
    when: DateTime,
    marketOpenNow: boolean,
    note: string,
  ): ExecutionSchedule {
    return {
      executeAt: when.toUTC().toISO()!,
      executeAtMarketTime: when.toISO()!,
      marketOpenNow,
      timezone: this.config.market.timezone,
      note,
    };
  }
}
