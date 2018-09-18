import { EventEmitter } from "events";
import { setTimeout, clearTimeout } from 'timers';
import * as _ from "underscore";

export type TickCallback = (item: ITickItem, tick: number) => void;
export type StartCallback = () => void;
export type StopCallback = () => void;
export type ThrottleCallback = (tick: number, time: number) => void;

export interface ITickItem {
	/**
	 * Time in milliseconds to show tick item
	 */
	time?: number;
}

export function isTickItem(value: any): value is ITickItem {
	if (typeof value === 'object') {
		let { time } = (value as ITickItem);
		return typeof time === 'number' || typeof time === 'undefined';
	} else {
		return false;
	}
}

export interface ITickerOptions {
	/**
	 * Fallback time in milliseconds to show tick item
	 */
	interval: number;
	/**
	 * Tick items
	 */
	ticks: ITickItem[];
}

export interface ITicker extends EventEmitter, ITickerOptions {
	/**
	 * Current tick item's index
	 */
	readonly tick: number;
	/**
	 * Is ticker running?
	 */
	readonly isRunning: boolean;

	start(this: ITicker): void;
	resume(this: ITicker): boolean;
	pause(this: ITicker): boolean;
	stop(this: ITicker): void;
	reset(this: ITicker): void;

	addListener(event: 'tick', callback: TickCallback): this;
	addListener(event: 'start', callback: StartCallback): this;
	addListener(event: 'stop', callback: StopCallback): this;
	addListener(event: 'throttle', callback: ThrottleCallback): this;

	emit(event: 'tick', item: ITickItem, tick: number): boolean;
	emit(event: 'start'): boolean;
	emit(event: 'stop'): boolean;
	emit(event: 'throttle', tick: number, time: number): boolean;

	on(event: 'tick', callback: TickCallback): this;
	on(event: 'start', callback: StartCallback): this;
	on(event: 'stop', callback: StopCallback): this;
	on(event: 'throttle', callback: ThrottleCallback): this;

	once(event: 'tick', callback: TickCallback): this;
	once(event: 'start', callback: StartCallback): this;
	once(event: 'stop', callback: StopCallback): this;
	once(event: 'throttle', callback: ThrottleCallback): this;

	prependListener(event: 'tick', callback: TickCallback): this;
	prependListener(event: 'start', callback: StartCallback): this;
	prependListener(event: 'stop', callback: StopCallback): this;
	prependListener(event: 'throttle', callback: ThrottleCallback): this;

	prependOnceListener(event: 'tick', callback: TickCallback): this;
	prependOnceListener(event: 'start', callback: StartCallback): this;
	prependOnceListener(event: 'stop', callback: StopCallback): this;
	prependOnceListener(event: 'throttle', callback: ThrottleCallback): this;

	removeListener(event: 'tick', callback: TickCallback): this;
	removeListener(event: 'start', callback: StartCallback): this;
	removeListener(event: 'stop', callback: StopCallback): this;
	removeListener(event: 'throttle', callback: ThrottleCallback): this;

}

export class Ticker extends EventEmitter implements ITicker {
	private _interval: number;
	private _ticks: ITickItem[];
	private _timeout: NodeJS.Timer | null;
	private _tick: number;

	private static _checkTicks(ticks: ITickItem[]): boolean {
		return (ticks instanceof Array) && _.all(ticks, isTickItem);
	}

	constructor(options: ITickerOptions) {
		if (!(typeof options === 'object')) {
			throw new TypeError('Instance of ITickerOptions expected as options');
		}
		let { interval, ticks } = options;
		if (!(typeof interval === 'number' && interval >= 0)) {
			throw new TypeError('Instance of positive number expected as options.interval');
		}

		if (!Ticker._checkTicks(ticks)) {
			throw new TypeError('Instance of non-empty ITickItem[] expected as options.ticks');
		}
		super();
		this._interval = interval;
		this._ticks = ticks;
		this._timeout = null;
		this._tick = 0;
	}

	get interval(): number {
		return this._interval;
	}

	set interval(value: number) {
		if (!(typeof value === 'number' && value > 0)) {
			throw new TypeError('Instance of positive number expected as value');
		}
		this._interval = value;
	}

	get ticks(): ITickItem[] {
		return this._ticks;
	}

	set ticks(value: ITickItem[]) {
		if (!Ticker._checkTicks(value)) {
			throw new TypeError('Instance of non-empty ITickItem[] expected as value');
		}
		this._ticks = value;
	}

	get tick(): number {
		return this._tick;
	}

	get isRunning(): boolean {
		return !!this._timeout;
	}

	start(this: Ticker) {
		this.stop();
		this.resume();
		this.emit('start');
	}

	resume(this: Ticker): boolean {
		if (!this.isRunning) {
			this._timeout = setTimeout(this._processor.bind(this, Date.now()), 0);
			return true;
		} else {
			return false;
		}
	}

	pause(this: Ticker) {
		if (this.isRunning) {
			clearTimeout(this._timeout!);
			this._timeout = null;
			return true;
		} else {
			return false;
		}
	}

	stop(this: Ticker) {
		this.reset();
		if (this.pause()) {
			this.emit('stop');
		}
	}

	reset(this: Ticker) {
		this._tick = 0;
	}

	private _processor(this: Ticker, expectedCall: number): void {
		let running = true;
		while (running) {
			this._tick = this._tick % Math.max(this._ticks.length, 1);
			const tickItem = this._ticks.length !== 0 ? this._ticks[this._tick] : {};
			const interval = typeof tickItem.time === 'number' && tickItem.time >= 0 ? tickItem.time : this._interval;
			if (interval <= 0) {
				this._timeout = null;
				this.emit('tick', tickItem, this._tick);
				this.emit('stop');
				running = false;
			} else {
				const current = Date.now();
				expectedCall += interval;
				const timeout = expectedCall - current;
				if (timeout < 1) {
					this.emit('throttle', timeout);
					console.warn(`[THROTTLE] Tick '${this._tick}'`, timeout);
				} else {
					this.emit('tick', tickItem, this._tick);
					this._timeout = setTimeout(this._processor.bind(this, expectedCall), timeout);
					running = false;
				}
			}
			this._tick += 1;
		}
	}
}
