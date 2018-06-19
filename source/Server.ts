import { EventEmitter } from "events";
import * as express from "express";
import * as fs from "fs";
import * as path from "path";
import * as MimeIs from "type-is";
import * as os from "os";
import * as _ from "underscore";
import * as url from "url";
import * as gm from "gm";

import { ISliderController, SliderController } from "./SliderController";
import { getImageMime, loadSlides, pad } from "./utilities";
import { Deferred } from "./Deferred";
import { ISlide } from "./Slide";
import { Dictionary } from "underscore";

interface IFrameGeometry {
	width: number;
	height: number;
	left: number;
	top: number;
}

interface IAnimationInfo {
	Format: string[];
	format: string;
	Geometry: string[];
	size: gm.Dimensions;
	Class: string[];
	Type: string[];
	Depth: string[];
	depth: number;
	'Channel Depths': gm.ChannelInfo<string>;
	'Channel Statistics': gm.ChannelInfo<gm.ColorStatistics>;
	Colors: Dictionary<string>;
	color: number;
	Filesize: string[];
	Interlace: string[];
	Orientation: string;
	'Background Color': string[];
	'Border Color': string[];
	'Matte Color': string[];
	'Page geometry': string[];
	Compose: string[];
	Dispose: string[];
	Delay: string[];
	Scene: string[];
	Compression: string[];
	Signature: string[];
	Tainted: string[];
	'User Time': string[];
	'Elapsed Time': string[];
	'Pixels Per Second': string[];
	path: string;
}

function isAnimationInfo(info: gm.ImageInfo | IAnimationInfo): info is IAnimationInfo {
	return 'Delay' in info;
}

type InternalSlidesCallback = (directoryPath: string, cookie: number) => void;

const redirectTemplate = _.template(
	'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Redirecting to <%= location.title %></title></head><body><pre>Redirecting to <a href="<%= location.url %>"><%= location.title %></a></pre></body>'
);

interface IInternalEmitter extends EventEmitter {
	addListener(event: 'slides', callback: InternalSlidesCallback): this;

	emit(event: 'slides', directoryPath: string, cookie: number): boolean;

	on(event: 'slides', callback: InternalSlidesCallback): this;

	once(event: 'slides', callback: InternalSlidesCallback): this;

	prependListener(event: 'slides', callback: InternalSlidesCallback): this;

	prependOnceListener(event: 'slides', callback: InternalSlidesCallback): this;

	removeListener(event: 'slides', callback: InternalSlidesCallback): this;
}

export interface IServerOptions {
	prefix: string;
	target: string;
	sources: string[];
	interval: number;
	mimes: string[];
}

export class SlidesServer extends EventEmitter {
	private static _S_emitter: IInternalEmitter = new EventEmitter();

	static getDefaultOptions(): IServerOptions {
		return {
			prefix: '/',
			target: '',
			sources: [],
			interval: 1000,
			mimes: getImageMime()
		};
	}

	private _express: express.Express;
	private _target: string;
	private _sources: string[];
	private _prefix: string;
	private _currentSource?: string;
	private _cookie: number;
	private _controller: ISliderController;
	private _mimes: string[];

	constructor(options?: Partial<IServerOptions>) {
		super();
		let _options: IServerOptions = SlidesServer.getDefaultOptions();
		if (typeof options !== 'undefined') {
			if (typeof options !== 'object') {
				throw new TypeError('Instance of object expected as options');
			}
			if (typeof options.prefix !== 'undefined') {
				if (typeof options.prefix !== 'string') {
					throw new TypeError('Instance of string expected as options.prefix');
				} else {
					_options.prefix = options.prefix;
				}
			}
			if (typeof options.target !== 'undefined') {
				if (typeof options.target !== 'string') {
					throw new TypeError('Instance of string expected as options.target');
				} else {
					_options.target = options.target;
				}
			}
			if (typeof options.sources !== 'undefined') {
				if (!(options.sources instanceof Array && _.all(options.sources, (value) => typeof value === 'string'))) {
					throw new TypeError('Instance of string[] expected as options.sources');
				} else {
					_options.sources = options.sources;
				}
			}
			if (typeof options.interval !== 'undefined') {
				if (!(typeof options.interval === 'number' && options.interval > 0)) {
					throw new TypeError('Instance of positive number expected as options.interval');
				} else {
					_options.interval = options.interval;
				}
			}
			if (typeof options.mimes !== 'undefined') {
				if (!(options.mimes instanceof Array && _.all(options.mimes, (value) => typeof value === 'string'))) {
					throw new TypeError('Instance of string[] expected as options.mimes');
				} else {
					_options.mimes = options.mimes;
				}
			}
		}
		let app = this._express = express();
		let prefix = this._prefix = _options.prefix;
		this._target = _options.target;
		this._sources = _options.sources;
		this._currentSource = undefined;
		this._mimes = _options.mimes;
		app.get(path.posix.join(prefix, 'slides', ':id', ':modified'), this.serveSlide.bind(this));
		app.get(path.posix.join(prefix, 'slides', ':id'), this.serveSlide.bind(this));
		app.put(path.posix.join(prefix, 'slides'), this.putSlides.bind(this));
		app.options(path.posix.join(prefix, 'slides'), this.optionsSlides.bind(this));

		this._controller = new SliderController();
		this._controller.interval = _options.interval;
		this._cookie = Date.now();

		SlidesServer._S_emitter.on('slides', this._onNewSlides.bind(this));
	}

	get express(): express.Express {
		return this._express;
	}

	get prefix(): string {
		return this._prefix;
	}

	get source(): string | void {
		return this._currentSource;
	}

	get sources(): string[] {
		return this._sources;
	}

	get controller(): ISliderController {
		return this._controller;
	}

	get target(): string {
		return this._target;
	}

	get cookie(): number {
		return this._cookie;
	}

	get mimes(): string[] {
		return this._mimes;
	}

	_onNewSlides(this: SlidesServer, directoryPath: string, cookie: number) {
		if (this._cookie !== cookie) { // skipping current server
			let directoryIndex = this._sources.indexOf(directoryPath);
			let sourceIndex = typeof this._currentSource === 'string' ? this._sources.indexOf(this._currentSource) : -1;
			if (directoryIndex >= 0 && (sourceIndex < 0 || directoryIndex <= sourceIndex)) {
				this
					.refresh()
					.catch((error: Error) => {
						console.warn(`SlidesServer[${this._cookie} / ${JSON.stringify(this._currentSource)}].refresh(): ${error.name}: ${error.message}`);
					});
			}
		}
	}

	async optionsSlides(this: SlidesServer, request: express.Request, response: express.Response) {
		response.setHeader('Accept', this._mimes.join(', '));
		response.setHeader('Access-Control-Allow-Methods', ['PUT', 'OPTIONS'].join(', '));
		response.sendStatus(200);
	}

	async putSlides(this: SlidesServer, request: express.Request, response: express.Response) {
		//set unlimited timeout
		//to prevent empty reply from server due to long-time processing
		response.setTimeout(0);

		let contentType: any = request.headers['content-type'];
		if (
			!_.all(
				((contentType instanceof Array) ? contentType : [contentType]),
				(content: string) => !!MimeIs.is(content, this._mimes)
			)
		) {
			response.sendStatus(406);
			return;
		}
		let tmpDir: string | void;
		let targetFilePath: string | void;
		try {
			let tmpDeferred = new Deferred<NodeJS.ErrnoException, [string]>();
			let writeDeferred = new Deferred<NodeJS.ErrnoException, [void]>();
			fs.mkdtemp(path.join(os.tmpdir(), "slides-"), tmpDeferred.unsafe);
			[tmpDir] = await tmpDeferred.promise;
			targetFilePath = path.join(tmpDir, "target");
			let targetStream = fs.createWriteStream(targetFilePath);
			request.pipe(targetStream);
			request.on('error', writeDeferred.unsafe);
			targetStream.on('close', writeDeferred.safe);
			targetStream.on('error', writeDeferred.unsafe);
			await writeDeferred.promise;
			await this.save(targetFilePath);
			await this.refresh();
			console.info('DONE');
			response.sendStatus(200);
		} catch (error) {
			console.warn(`SliderApp.putSlides(request, response): ${error.stack}`);
			response.sendStatus(500);
		} finally {
			if (typeof targetFilePath === 'string') {
				let existsDeferred = new Deferred<NodeJS.ErrnoException, [boolean]>();
				fs.exists(targetFilePath, existsDeferred.safe);
				let [exists] = await existsDeferred.promise;
				if (exists) {
					let unlinkDeferred = new Deferred<NodeJS.ErrnoException, [void]>();
					fs.unlink(targetFilePath, unlinkDeferred.unsafe);
					try {
						await unlinkDeferred.promise;
					} catch (error) {
						console.warn(`SliderApp.putSlides(request, response): ${error.stack}`);
					}
				}
				if (typeof tmpDir === 'string') {
					let rmdirDeferred = new Deferred<NodeJS.ErrnoException, [void]>();
					fs.rmdir(tmpDir, rmdirDeferred.unsafe);
					try {
						await rmdirDeferred.promise;
					} catch (error) {
						console.warn(`SliderApp.putSlides(request, response): ${error.stack}`);
					}
				}
			}
		}
	}

	async serveSlide(this: SlidesServer, request: express.Request, response: express.Response) {
		let _id: string = request.params.id;
		let _modified: string | void = request.params.modified;
		let id: number;
		let modified: number | void;
		try {
			id = parseInt(_id, 10);
			if (typeof _modified === 'number') {
				modified = parseInt(_modified, 10);
			}
		} catch (error) {
			console.warn(`SliderApp.serveSlide(request, response): ${error.stack}`)
			response.sendStatus(404);
			return;
		}
		let parsedUrl = url.parse(request.url);
		let slides = this._controller.slides;
		if (0 <= id && id < slides.length) {
			let slide = slides[id];
			if (slide.reference !== parsedUrl.pathname) {
				let html = redirectTemplate({
					location: {
						url: slide.reference,
						title: slide.alt
					}
				});
				response.statusCode = 301;
				response.setHeader('Content-Type', 'text/html; charset=UTF-8');
				response.setHeader('Content-Length', Buffer.byteLength(html));
				response.setHeader('Content-Security-Policy', "default-src 'self'");
				response.setHeader('X-Content-Type-Options', 'nosniff');
				response.setHeader('Location', slide.reference);
				response.end(html);
			} else {
				response.setHeader('Content-Type', slide.mime);
				response.sendFile(slide.path);
			}
		} else {
			response.sendStatus(404);
		}
	}

	async refresh(this: SlidesServer) {
		let slides: ISlide[] = [];
		try {
			slides = await this._load();
		} catch (error) {
			console.warn(`SliderApp.refresh(): ${error.stack}`);
			slides = [];
		}
		if (!_.isEqual(slides, this._controller.slides)) {
			let running = this._controller.isRunning;
			this._controller.slides = slides;
		}
	}

	async save(this: SlidesServer, sourcePath: string) {
		let existsDeferred = new Deferred<NodeJS.ErrnoException, [boolean]>();
		fs.exists(sourcePath, existsDeferred.safe);
		let [exists] = await existsDeferred.promise;
		if (!exists) {
			throw new Error(`${JSON.stringify(sourcePath)} does not exists`);
		}
		await this._save(sourcePath);
		SlidesServer._S_emitter.emit('slides', this.target, this.cookie);
	}

	async _load(this: SlidesServer): Promise<ISlide[]> {
		let slides: ISlide[] = [];
		for (let source of this.sources) {
			try {
				slides = await loadSlides(this.prefix, source, this._mimes);
				if (slides instanceof Array && slides.length > 0) {
					this._currentSource = source;
					return slides;
				}
			} catch (error) {
				console.warn(`SliderApp._load(): ${error.stack}`);
			}
		}
		this._currentSource = undefined;
		return [];
	}

	async _save(this: SlidesServer, sourcePath: string) {
		let targetDirectory = this.target;
		try {
			let deferred = new Deferred<NodeJS.ErrnoException, [fs.Stats]>();
			fs.stat(targetDirectory, deferred.unsafe);
			let [stat] = await deferred.promise;
			if (!stat.isDirectory()) {
				throw new Error(`${JSON.stringify(targetDirectory)} is not directory`);
			}
		} catch (error) {
			throw new Error(`Invalid target directory. Reason: ${error.message}`);
		}
		let originalFiles: string[] = [];
		try {
			let deferred = new Deferred<NodeJS.ErrnoException, [string[]]>();
			fs.readdir(this.target, deferred.unsafe);
			let [files] = await deferred.promise;
			originalFiles = files.map((file) => path.join(targetDirectory, file));
		} catch (error) {
			console.warn(`SliderApp._save(sourcePath): ${error.stack}`);
		}
		let newFiles: string[] = [];
		let graph = gm(sourcePath);
		try {
			let globalIdentifyDeferred = new Deferred<Error, [gm.ImageInfo | IAnimationInfo]>();
			graph.identify(globalIdentifyDeferred.unsafe);
			let [imageFormat] = await globalIdentifyDeferred.promise;
			if (isAnimationInfo(imageFormat)) {
				let {
					Delay: _delay,
					size,
					'Background Color': background,
					'Border Color': _border,
					'Page geometry': _geometry,
					'Compose': compose
				} = imageFormat;
				let delay: number[] = _delay
					.map((value: any): number => {
						switch (typeof value) {
							case 'string':
								return parseInt(value, 10);
							case 'number':
								return value;
							default:
								return 0;
						}
					})
					.map((value) => value * 10);
				let geometry: (IFrameGeometry | null)[] = _geometry
					.map((geometryString): IFrameGeometry | null => {
						let match = /^(\d+)x(\d+)[+](\d+)[+](\d+)$/.exec(geometryString);
						if (match instanceof Array) {
							return {
								width: parseInt(match[1], 10),
								height: parseInt(match[2], 10),
								left: parseInt(match[3], 10),
								top: parseInt(match[4], 10)
							};
						} else {
							return null;
						}
					});
				let tmpSlidePath = path.join(targetDirectory, '_tmp.gif');
				let lastSlidePath = path.join(targetDirectory, '_last.gif');
				for (let slide = 0; slide !== delay.length; ++slide) {
					let targetDelay = delay[slide].toString(10);
					let targetIndex = pad(slide, 10, '0', 4);
					let targetFilePath = path.join(targetDirectory, `slide.${targetIndex}.${targetDelay}.gif`);

					if (slide === 0) {
						let writeDeferred = new Deferred<Error, [string, string, string]>();
						gm(size.width, size.height, background[0])
							.write(lastSlidePath = targetFilePath, writeDeferred.unsafe);
						await writeDeferred.promise;
					}

					{
						let tmpDeferred = new Deferred<Error, [string, string, string]>();
						(graph as any).selectFrame(slide); // @todo State.selectFrame(slide: number)
						(graph as any).out('+adjoin'); // @todo State.out(option: string)
						graph.write(tmpSlidePath, tmpDeferred.unsafe);
						await tmpDeferred.promise;
					}

					{
						let slideGeometry = geometry[slide];
						if (slideGeometry === null) {
							slideGeometry = {
								width: 0,
								height: 0,
								left: 0,
								top: 0
							};
						}
						let writeDeferred = new Deferred<Error, [string, string, string]>();
						let local_image = gm(lastSlidePath);
						(local_image as any).composite(tmpSlidePath); // @todo State.composite(imagePath: string)
						local_image.geometry(`+${slideGeometry.left}+${slideGeometry.top}`);
						local_image.compose(compose[slide]);
						local_image.write(lastSlidePath = targetFilePath, writeDeferred.unsafe);
						await writeDeferred.promise;
					}

					try {
						let unlinkDeferred = new Deferred<NodeJS.ErrnoException, [void]>();
						fs.unlink(tmpSlidePath, unlinkDeferred.unsafe);
						await unlinkDeferred.promise;
					} catch (error) {
						// ignore
					}

					newFiles.push(targetFilePath);
				}
			} else {
				let writeDeferred = new Deferred<Error, [string, string, string]>();
				let targetFilePath = path.join(targetDirectory, `slide.0000.0.jpg`);
				graph.write(targetFilePath, writeDeferred.unsafe);
				await writeDeferred.promise;
				newFiles.push(targetFilePath);
			}
		} catch (error) {
			throw new Error(`Invalid source. Reason: ${error.message}`);
		}
		for (let original of originalFiles) {
			if (newFiles.indexOf(original) < 0) {
				try {
					let deferred = new Deferred<NodeJS.ErrnoException, [void]>();
					fs.unlink(original, deferred.unsafe);
					await deferred.promise;
				} catch (error) {
					console.warn(`SliderApp._save(sourcePath): ${error.stack}`);
				}
			}
		}
	}
}


// Usage example
/*

let secapp = new SlidesServer({
	prefix: '/secondary',
	target: '/tmp/images/secondary',
	sources: [
		'/tmp/images/secondary',
		'/tmp/images/main',
		'/tmp/images/fallback'
	]
});
secapp.model.on('changed', (value) => {
	console.info('[SECONDARY][CHANGED]', value);
	if (!secapp.model.isRunning) {
		secapp.model.start();
	}
});

secapp.refresh();

let mainapp = new SlidesServer({
	prefix: '/main',
	target: '/tmp/images/main',
	sources: [
		'/tmp/images/main',
		'/tmp/images/fallback'
	]
});

mainapp.model.on('changed', (value) => {
	console.info('[MAIN][CHANGED]', value);
	if (!mainapp.model.isRunning) {
		mainapp.model.start();
	}
});
mainapp.refresh();

console.info(`MAIN COOKIE ${mainapp.cookie}`);
console.info(`SEC COOKIE ${secapp.cookie}`);

let app = express();
app.use(mainapp.express);
app.use(secapp.express);
app.listen(3000);

*/
