import { EventEmitter } from "events";
import * as _ from "underscore";

import { ISlide, isSlide } from "./Slide";
import { ITicker, Ticker } from "./Ticker";

export interface ISliderModel {
	slides: ISlide[];
	current: number;
}

export type ChangedCallback = (changes: Partial<ISliderModel>) => void;
export type StartCallback = () => void;
export type StopCallback = () => void;

export interface ISliderController extends ISliderModel, EventEmitter {
	interval: number;
	readonly isRunning: boolean;

	start(this: ISliderController): void;
	stop(this: ISliderController): void;
	pause(this: ISliderController): void;
	resume(this: ISliderController): void;

	addListener(event: 'changed', callback: ChangedCallback): this;
	addListener(event: 'start', callback: StartCallback): this;
	addListener(event: 'stop', callback: StopCallback): this;

	emit(event: 'changed', changes: Partial<ISliderModel>): boolean;
	emit(event: 'start'): boolean;
	emit(event: 'stop'): boolean;

	on(event: 'changed', callback: ChangedCallback): this;
	on(event: 'start', callback: StartCallback): this;
	on(event: 'stop', callback: StopCallback): this;

	once(event: 'changed', callback: ChangedCallback): this;
	once(event: 'start', callback: StartCallback): this;
	once(event: 'stop', callback: StopCallback): this;

	prependListener(event: 'changed', callback: ChangedCallback): this;
	prependListener(event: 'start', callback: StartCallback): this;
	prependListener(event: 'stop', callback: StopCallback): this;

	prependOnceListener(event: 'changed', callback: ChangedCallback): this;
	prependOnceListener(event: 'start', callback: StartCallback): this;
	prependOnceListener(event: 'stop', callback: StopCallback): this;

	removeListener(event: 'changed', callback: ChangedCallback): this;
	removeListener(event: 'start', callback: StartCallback): this;
	removeListener(event: 'stop', callback: StopCallback): this;
}

export class SliderController extends EventEmitter implements ISliderController {
	private _model: ISliderModel;
	private _ticker: ITicker;

	private _onTick(this: SliderController, item: ISlide, tick: number): void {
		this.emit('changed', { current: tick });
	}

	constructor() {
		super();
		let slides: ISlide[] = [];
		this._ticker = new Ticker({
			interval: 0,
			ticks: slides
		});
		this._model = {
			slides: slides,
			current: this._ticker.tick
		};
		this._ticker.on('tick', this._onTick.bind(this));
		this._ticker.on('start', this.emit.bind(this, 'start'));
		this._ticker.on('stop', this.emit.bind(this, 'stop'));
	}

	get current(): number {
		return this._model.current;
	}

	set current(value: number) {
		if (typeof value === 'number') {
			value = Math.floor(value);
			let mod = Math.max(this._model.slides.length, 1);
			if (value < 0) {
				value = (this._model.slides.length - value) % mod;
			} else {
				value = value % mod;
			}
			if (value !== this._model.current) {
				this._model.current = value;
				this.emit('changed', { current: value });
			}
		}
	}

	get slides(): ISlide[] {
		return this._model.slides;
	}

	set slides(value: ISlide[]) {
		if (value instanceof Array && _.all(value, isSlide)) {
			if (!_.isEqual(this._ticker.ticks, value)) {
				let running = this._ticker.isRunning;
				if (running) {
					this._ticker.stop();
				}
				this._ticker.ticks = value;
				this._model.slides = value;
				this._model.current = 0;
				this.emit('changed', {
					slides: this._model.slides,
					current: this._model.current
				});
				if (running) {
					this._ticker.start();
				}
			}
		}
	}

	get interval(): number {
		return this._ticker.interval;
	}

	set interval(value: number) {
		if (typeof value !== 'number' && value >= 0) {
			throw new TypeError('Instance of positive number expected as value');
		}
		this._ticker.interval = value;
	}

	get isRunning(): boolean {
		return this._ticker.isRunning;
	}

	start(this: SliderController): void {
		this._ticker.start();
	}

	pause(this: SliderController): void {
		this._ticker.pause();
	}

	resume(this: SliderController): void {
		this._ticker.resume();
	}

	stop(this: SliderController): void {
		this._ticker.stop();
	}
}
