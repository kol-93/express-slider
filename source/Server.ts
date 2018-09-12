import * as crypto from "crypto";
import { IncomingHttpHeaders } from "http2";
import { EventEmitter } from "events";
import { ChildProcess } from "child_process";
import { promisify } from "util";
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
	lastPromotionDir: string; //dir where saved last loaded '*.gif' file with promotions 
}

export class SlidesServer extends EventEmitter {
	private static _S_emitter: IInternalEmitter = new EventEmitter();

	static getDefaultOptions(): IServerOptions {
		return {
			prefix: '/',
			target: '',
			sources: [],
			interval: 1000,
			mimes: getImageMime(),
			lastPromotionDir: path.join(os.tmpdir(), 'lastpromo')
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
	private _maxRunningProcessors: number;
	private _parseQueue: Map<string, ChildProcess>;

	constructor(options?: Partial<IServerOptions>) {
		super();
		this._maxRunningProcessors = 5;
		this._parseQueue = new Map();
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
			if (typeof options.lastPromotionDir !== 'undefined') {
				if (typeof options.lastPromotionDir !== 'string') {
					throw new TypeError('Instance of string expected as options.lastPromotionDir');
				} else {
					_options.lastPromotionDir = options.lastPromotionDir;
				}
			}
		}
		let prefix = this._prefix = _options.prefix;
		this._express = express();
		this._target = _options.target;
		this._sources = _options.sources;
		this._currentSource = undefined;
		this._mimes = _options.mimes;
		this._createDir(_options.lastPromotionDir, 0o644);
		this._express.get(path.posix.join(prefix, 'slides', ':id', ':modified'), this.serveSlide.bind(this));
		this._express.get(path.posix.join(prefix, 'slides', ':id'), this.serveSlide.bind(this));
		this._express.put(path.posix.join(prefix, 'slides'), this.PutSlides.bind(this));
		this._express.options(path.posix.join(prefix, 'slides'), this.optionsSlides.bind(this));

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

	private async _createDir(dirPath: string, mode?: string | number | null | undefined): Promise<void> {
		console.log(`[SLIDES][${this.prefix}] Start to create dir:`, dirPath, `mode:`, mode);
		try {
			await promisify(fs.access)(dirPath, fs.constants.R_OK | fs.constants.W_OK);
			console.log(`[SLIDES][${this.prefix}] Last promotion dir already exists.`);
			return;
		} catch (error) {
			//do nothing
		}
		try {
			//create folder
			await promisify(fs.mkdir)(dirPath, mode || 0o644);
		} catch (error) {
			console.error(`[SLIDES][${this.prefix}][ERROR] Create dir`, error.message);
		}
	}

	private _checkContentType(headers: IncomingHttpHeaders): boolean {
		let contentType: any = headers['content-type'];
		if (
			!_.all(
				((contentType instanceof Array) ? contentType : [contentType]),
				(content: string) => !!MimeIs.is(content, this._mimes)
			)
		) {
			return false;
		}
		return true;
	}

	private async _makeTmpDir(prefix: string): Promise<string> {
		const tmpPath = path.join(os.tmpdir(), prefix);
		return promisify(fs.mkdtemp)(tmpPath, 'utf8');
	}

	private async _rmDirRecursively(dir: string): Promise<void> {
		if (await promisify(fs.exists)(dir)) {
			const content = (await promisify(fs.readdir)(dir)).map(async file => {
				const curPath = path.join(dir, file);
				if ((await promisify(fs.lstat)(curPath)).isDirectory()) { // recurse
					await this._rmDirRecursively(curPath);
				} else { // delete file
					await promisify(fs.unlink)(curPath);
				}
			});
			await Promise.all(content);
			await promisify(fs.rmdir)(dir);
		}
	}

	private _writeTargetFile(filePath: string, request: express.Request): Promise<void> {
		const targetStream = fs.createWriteStream(filePath, { autoClose: true });
		request.pipe(targetStream);
		const writeResult = new Promise<void>((resolve, reject) => {
			request.on('error', reject);
			targetStream.on('error', reject);
			targetStream.on('close', resolve);
		});
		return writeResult;
	}

	private async _compareFiles(oldFilePath: string, newFilePath: string): Promise<boolean> {
		let result = false;
		try {
			//check if exists and can read
			const exists = promisify(fs.access);
			await exists(oldFilePath, fs.constants.R_OK);
			const oldFile = await promisify(fs.readFile)(oldFilePath, { encoding: 'utf8' });
			const newFile = await promisify(fs.readFile)(newFilePath, { encoding: 'utf8' });
			const oldHash = crypto.createHash('md5').update(oldFile).digest('hex');
			const newHash = crypto.createHash('md5').update(newFile).digest('hex');
			result = _.isEqual(oldHash, newHash);
			console.log(`Hash:`, 'oldHash', oldHash, 'new hash', newHash, 'are equal:', result);
		} catch (error) {
			console.error(`[SLIDES][ERROR] ${this.prefix} compare files`, error);
			result = false;
		}
		return result;
	}

	async PutSlides(this: SlidesServer, request: express.Request, response: express.Response) {
		//set unlimited timeout
		//to prevent empty reply from server due to long-time processing
		response.setTimeout(0);

		console.log(`[SLIDES][PUT] '${this.prefix}' Start saving slides.`);

		//check if content type is 'image/gif'
		const isMedia = this._checkContentType(request.headers);
		if (!isMedia) {
			console.log(`[SLIDES][PUT] '${this.prefix}' Response code 406. Not a media. Stop parse file.`);
			response.sendStatus(406);
		}

		//make temp dir for incoming gif file
		const tmpSlidesPath = await this._makeTmpDir('slides-vik-');
		console.log(`[SLIDES][PUT] '${this.prefix}' tmpSlidesPath`, tmpSlidesPath);
		// let targetFilePath: string | undefined;

		try {
			//write gif file to tmp dir (stream)
			const targetName = 'target';
			const targetFilePath = path.join(tmpSlidesPath, targetName);
			console.log(`[SLIDES][PUT] '${this.prefix}' targetFilePath`, tmpSlidesPath);
			await this._writeTargetFile(targetFilePath, request);

			//find md5 hash of loaded file
			//find sha hash of loaded file
			//check if such file already exists in folder project (last loaded promotions) - check both hashes
			const lastPromoFile = path.join(SlidesServer.getDefaultOptions().lastPromotionDir, targetName);
			const isFilesEqual = await this._compareFiles(lastPromoFile, targetFilePath);




		} catch (error) {
			console.log(`[SLIDES][PUT][ERROR] '${this.prefix}'`, error);
			await this._rmDirRecursively(tmpSlidesPath);
		}





		//-- if such file already exists - ignore processing - response 304
		//check if previous forked child processes exist and they count less then 'this._maxRunningProcessors'
		//if child process more or equal - kill the most older process
		//fork new child process and register it to queue
		//copy file to storage of last loaded file '/var/lib/rik....'
		//create temporary directory for saving new slides '/tmp/.....'
		//parse this file to separated images and save to tmp directory created before
		//send message to main process that files are already parsed
		//close this child process and delete it from queue
		//copy new slides from tmp directory to project directory '/opt/rik/public/media/slides....
		//refresh slider
		//delete temporary directory
		//send response 200
		//if error send response 500

	}


	async putSlides(this: SlidesServer, request: express.Request, response: express.Response) {
		//set unlimited timeout
		//to prevent empty reply from server due to long-time processing
		response.setTimeout(0);

		console.log(`[${this.prefix}][PUT] start putSlides()`);

		let contentType: any = request.headers['content-type'];
		if (
			!_.all(
				((contentType instanceof Array) ? contentType : [contentType]),
				(content: string) => !!MimeIs.is(content, this._mimes)
			)
		) {
			console.log(`[${this.prefix}][PUT] response.sendStatus(406)`);
			response.sendStatus(406);
			return;
		}
		let tmpDir: string | void;
		let targetFilePath: string | void;
		try {
			let tmpDeferred = new Deferred<NodeJS.ErrnoException, [string]>();
			let writeDeferred = new Deferred<NodeJS.ErrnoException, [void]>();
			let dirPath = path.join(os.tmpdir(), "slides-");
			fs.mkdtemp(dirPath, tmpDeferred.unsafe);
			console.log(`[${this.prefix}][PUT] tmp dirPath`, dirPath);
			[tmpDir] = await tmpDeferred.promise;
			targetFilePath = path.join(tmpDir, "target");
			console.log(`[${this.prefix}][PUT] targetFilePath`, targetFilePath);
			let targetStream = fs.createWriteStream(targetFilePath);
			request.pipe(targetStream);
			request.on('error', writeDeferred.unsafe);
			targetStream.on('close', writeDeferred.safe);
			targetStream.on('error', writeDeferred.unsafe);
			console.log(`[${this.prefix}][PUT] Incoming file saved`);
			await writeDeferred.promise;
			console.log(`[${this.prefix}][PUT] await writeDeferred.promise`);
			await this.save(targetFilePath);
			console.log(`[${this.prefix}][PUT] save`, targetFilePath);
			await this.refresh();
			console.info(`[${this.prefix}][PUT] DONE`);
			response.sendStatus(200);
			console.info(`[${this.prefix}][PUT] response.sendStatus(200)`);
		} catch (error) {
			console.warn(`SliderApp.putSlides(request, response): ${error.stack}`);
			response.sendStatus(500);
		} finally {
			console.log(`[${this.prefix}][PUT] block finally`);
			if (typeof targetFilePath === 'string') {
				console.log(`[${this.prefix}][PUT] finally targetFilePath === string`);
				let existsDeferred = new Deferred<NodeJS.ErrnoException, [boolean]>();
				fs.exists(targetFilePath, existsDeferred.safe);
				let [exists] = await existsDeferred.promise;
				if (exists) {
					console.log(`[${this.prefix}][PUT] finally exists`, exists);
					let unlinkDeferred = new Deferred<NodeJS.ErrnoException, [void]>();
					console.log(`[${this.prefix}][PUT] fs.unlink`, targetFilePath);
					fs.unlink(targetFilePath, unlinkDeferred.unsafe);
					try {
						console.log(`[${this.prefix}][PUT] finally unlinkDeferred.promise`);
						await unlinkDeferred.promise;
					} catch (error) {
						console.warn(`SliderApp.putSlides(request, response): ${error.stack}`);
					}
				}
				if (typeof tmpDir === 'string') {
					console.log(`[${this.prefix}][PUT] finally tmpDir === string`);
					let rmdirDeferred = new Deferred<NodeJS.ErrnoException, [void]>();
					console.log(`[${this.prefix}][PUT] fs.rmdir`, tmpDir);
					fs.rmdir(tmpDir, rmdirDeferred.unsafe);
					try {
						console.log(`[${this.prefix}][PUT] finally rmdirDeferred.promise`);
						await rmdirDeferred.promise;
					} catch (error) {
						console.warn(`SliderApp.putSlides(request, response): ${error.stack}`);
					}
				}
			}
		}
		console.log(`[${this.prefix}][PUT] Completed!!!`);
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
/**
 * Check if this file (server.ts) launches directly (ts-node server.ts) or requires as module
 */
if (require.main === module) {
	const root = '.';
	const secondary = path.join(root, 'images', 'secondary');
	const main = path.join(root, 'images', 'main');
	const fallback = path.join(root, 'images', 'fallback');

	let secapp = new SlidesServer({
		prefix: '/secondary',
		target: secondary,
		sources: [
			secondary,
			main,
			fallback,
		]
	});
	secapp.controller.on('changed', (value) => {
		console.info('[SECONDARY][CHANGED]', JSON.stringify(value).slice(0, 100));
		if (!secapp.controller.isRunning) {
			secapp.controller.start();
		}
	});

	secapp.refresh();

	let mainapp = new SlidesServer({
		prefix: '/main',
		target: main,
		sources: [
			main,
			fallback,
		]
	});

	mainapp.controller.on('changed', (value) => {
		console.info('[MAIN][CHANGED]', JSON.stringify(value).slice(0, 100));
		if (!mainapp.controller.isRunning) {
			mainapp.controller.start();
		}
	});
	mainapp.refresh();

	console.info(`MAIN COOKIE ${mainapp.cookie}`);
	console.info(`SEC COOKIE ${secapp.cookie}`);

	let app = express();
	app.use(mainapp.express);
	app.use(secapp.express);
	app.listen(3000);
}
