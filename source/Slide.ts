import {ITickItem, isTickItem} from "./Ticker";

export interface ISlide extends ITickItem {
	reference: string;
	alt?: string;
	mime: string;
	path: string;
	modified: number;
}

export function isSlide(value: any): value is ISlide {
	if (isTickItem(value)) {
		let {reference, alt, mime, path} = value as ISlide;
		return typeof reference === 'string' &&
			(typeof alt === 'string' || typeof alt === 'undefined') &&
			typeof mime === 'string' &&
			typeof path === 'string';
	} else {
		return false;
	}
}

export class Slide implements ISlide {
	private _container: ISlide;
	
	constructor(options: ISlide) {
		if (!isSlide(options)) {
			throw new TypeError('Instance of ISlide expected as options');
		}
		let { reference, alt, time, mime, path, modified } = options;
		this._container = {reference, alt, time, mime, path, modified };
	}
	
	get reference(): string {
		return this._container.reference;
	}
	
	set reference(value: string) {
		this._container.reference = value;
	}
	
	get alt(): string | undefined {
		return this._container.alt;
	}
	
	set alt(value: string | undefined) {
		this._container.alt = value;
	}
	
	get time(): number | undefined {
		return this._container.time;
	}
	
	set time(value: number | undefined) {
		this._container.time = value;
	}
	
	get mime(): string {
		return this._container.mime;
	}
	
	set mime(value: string) {
		this._container.mime = value;
	}
	
	get path(): string {
		return this._container.path;
	}
	
	set path(value: string) {
		this._container.path = value;
	}
	
	get modified(): number {
		return this._container.modified;
	}
	
	set modified(value: number) {
		this._container.modified = value;
	}
}
