import * as path from "path";
import * as fs from "fs";
import * as mmmagic from "mmmagic";
import * as MimeIs from "type-is";
import * as url from "url";

import {Deferred} from "./Deferred";
import {IFactory, ITypeMarker, SingleInstanceFactory} from "./factory/Factory";
import {ISlide, isSlide} from "./Slide";
import {Stats} from "fs";

export const SlideNameRE = /^([^.]+)\.(\d+)\.(\d+)$/;

export function getImageMime(): string[] {
	return ['image/*'];
}

export class InvalidSlideFileName extends Error {
	name: string;
	constructor(name: string) {
		super(`Invalid slide file name ${JSON.stringify(name)}`);
		this.name = 'InvalidSlideFileName';
	}
}

export class InvalidMimeType extends Error {
	name: string;
	constructor(mime: string) {
		super(`Invalid mime type ${JSON.stringify(mime)}`);
		this.name = 'InvalidMimeType';
	}
}


interface ISlideNameMeta {
	index: number;
	time: number;
	alt: string;
}

export interface ISlideMeta {
	index: number;
	slide: ISlide;
}

export class LazyMagicFactory implements IFactory<mmmagic.Magic, mmmagic.bitmask, ITypeMarker<mmmagic.bitmask>> {
	private _cache: Map<mmmagic.bitmask, mmmagic.Magic>;
	constructor() {
		this._cache = new Map();
	}
	
	createInstance(options: ITypeMarker<mmmagic.bitmask>): mmmagic.Magic {
		let magic = this._cache.get(options.signature);
		if (typeof magic === 'undefined') {
			this._cache.set(options.signature, magic = new mmmagic.Magic(options.signature));
			return magic;
		} else {
			return magic;
		}
	}
	
	private static _factory: LazyMagicFactory | null;
	
	static getFactory(): LazyMagicFactory {
		if (LazyMagicFactory._factory instanceof LazyMagicFactory) {
			return LazyMagicFactory._factory;
		} else {
			return LazyMagicFactory._factory = new LazyMagicFactory();
		}
	}
}


function parseSlideName(filePath: string): ISlideNameMeta {
	let ext = path.extname(filePath);
	let basename = path.basename(filePath, ext);
	let match = SlideNameRE.exec(basename);
	if (match instanceof Array && match[0] === basename) {
		let alt = match[1];
		let index = parseInt(match[2], 10);
		let time = parseInt(match[3], 10);
		return {
			index: index,
			time: time,
			alt: alt
		};
	} else {
		throw new InvalidSlideFileName(filePath);
	}
}

async function parseSlideFile(filePath: string, meta: ISlideNameMeta): Promise<ISlideMeta> {
	let statLock = new Deferred<NodeJS.ErrnoException, [Stats]>();
	let resolveLock = new Deferred<Error, [string]>();
	fs.stat(filePath, statLock.unsafe);
	let magic = LazyMagicFactory.getFactory().createInstance({ signature: mmmagic.MAGIC_MIME_TYPE });
	magic.detectFile(filePath, resolveLock.unsafe);
	let [[stat], [mime]] = await Promise.all([statLock.promise, resolveLock.promise]);
	return {
		index: meta.index,
		slide: {
			alt: meta.alt,
			time: meta.time,
			mime: mime,
			path: filePath,
			reference: '',
			modified: Date.parse(stat.mtime.toString()),
		}
	};
}

export async function loadSlide(filePath: string): Promise<ISlideMeta | null> {
	try {
		let nameMeta = parseSlideName(filePath);
		return await parseSlideFile(filePath, nameMeta);
	} catch (error) {
		let args = Array.prototype.slice.call(arguments).map(JSON.stringify);
		console.warn(`loadSlide(${args.join(', ')}): ${error.name}: ${error.message}`);
		return null;
	}
}

export function checkSlideMeta(meta: ISlideMeta | null, accepted?: string[]): meta is ISlideMeta {
	if (meta === null)
		return false;
	let clearAccepted: string[] = accepted instanceof Array ? accepted : getImageMime();
	return typeof meta === 'object' && typeof meta.index === 'number' && isSlide(meta.slide) && !!MimeIs.is(meta.slide.mime, clearAccepted);
}

export async function loadSlides(referecePrefix: string, sourceDirectory: string, accepted?: string[]): Promise<ISlide[]> {
	try {
		let filesLock = new Deferred<NodeJS.ErrnoException, [string[]]>();
		fs.readdir(sourceDirectory, filesLock.unsafe);
		let [files] = await filesLock.promise;
		let rawMeta = await Promise.all(
			files.map((baseName: string) => loadSlide(path.join(sourceDirectory, baseName)))
		);
		let filteredMeta: ISlideMeta[] = rawMeta
			.filter( (meta: ISlideMeta | null) => checkSlideMeta(meta, accepted)) as ISlideMeta[];
		filteredMeta
			.sort((left: ISlideMeta, right: ISlideMeta) => left.index - right.index);
		return filteredMeta
			.map(
				(meta: ISlideMeta, index: number) => {
					meta.slide.reference = url.format({
						pathname: path.posix.join(referecePrefix, 'slides', index.toString(), meta.slide.modified.toString())
					});
					return meta.slide
				});
	} catch (error) {
		let args = Array.prototype.slice.call(arguments).map(JSON.stringify);
		console.warn(`loadSlides(${args.join(', ')}): ${error.name}: ${error.message}`);
		throw error;
	}
}

export function pad(value: number, system: number, char: string, count: number) {
	if (typeof value !== 'number') {
		throw new TypeError('Instance of number expected as value');
	}
	if (!(typeof system === 'number' && system > 1 && Number.isInteger(system))) {
		throw new TypeError('Instance of integer number > 1 expected as system');
	}
	if (!(typeof char === 'string' && char.length)) {
		throw new TypeError('Instance of character expected as char');
	}
	if (!(typeof count === 'number' && count > 1 && Number.isInteger(count))) {
		throw new TypeError('Instance of integer number > 1 expected as count');
	}
	let signs = [];
	if (value < 0) {
		signs.push('-');
		value = - value;
	}
	let stringValue = value.toString(system);
	while (signs.length + stringValue.length < count) {
		signs.push('0');
	}
	return signs.join('') + stringValue;
}
