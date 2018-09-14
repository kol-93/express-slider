import * as crypto from "crypto";
import { IncomingHttpHeaders } from "http2";
import { EventEmitter } from "events";
import { ChildProcess, fork } from "child_process";
import { promisify } from "util";
import * as express from "express";
import * as fs from "fs";
import * as path from "path";
import * as MimeIs from "type-is";
import * as os from "os";
import * as _ from "underscore";
import * as url from "url";

import { ISliderController, SliderController } from "./SliderController";
import { getImageMime, loadSlides } from "./utilities";
import { Deferred } from "./Deferred";
import { ISlide } from "./Slide";
import { Queue } from "./queue/task.queue";
import { IInternalEmitter } from "./interfaces/IInternalEmitter";
import { ISlideServerOptions } from "./interfaces/ISlideServerOptions";


const redirectTemplate = _.template(
	'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Redirecting to <%= location.title %></title></head><body><pre>Redirecting to <a href="<%= location.url %>"><%= location.title %></a></pre></body>'
);

export class SlidesServer extends EventEmitter {
	private static _S_emitter: IInternalEmitter = new EventEmitter();
	private static _parseQueue = new Queue(-1, 1); //queue size unlimited (by -1), max count of concurrent tasks = 1 (by 1)

	static getDefaultOptions(): ISlideServerOptions {
		return {
			prefix: '/',
			target: '',
			sources: [],
			interval: 1000,
			mimes: getImageMime(),
			lastPromotionDir: path.join(os.tmpdir(), 'lastpromo')
		};
	}

	readonly express: express.Express;
	readonly target: string;
	readonly sources: string[];
	readonly prefix: string;
	private _currentSource?: string;
	readonly cookie: number;
	readonly controller: ISliderController;
	readonly mimes: string[];
	readonly lastPromotionDir: string;

	constructor(options?: Partial<ISlideServerOptions>) {
		super();
		let _options: ISlideServerOptions = SlidesServer.getDefaultOptions();
		this._validateOptions(options, _options);
		let prefix = this.prefix = _options.prefix;
		this.express = express();
		this.target = _options.target;
		this.sources = _options.sources;
		this._currentSource = undefined;
		this.mimes = _options.mimes;
		this.lastPromotionDir = _options.lastPromotionDir;
		this._createDir(this.lastPromotionDir, 0o644);
		this.express.get(path.posix.join(prefix, 'slides', ':id', ':modified'), this.serveSlide.bind(this));
		this.express.get(path.posix.join(prefix, 'slides', ':id'), this.serveSlide.bind(this));
		this.express.put(path.posix.join(prefix, 'slides'), this.PutSlides.bind(this));
		this.express.options(path.posix.join(prefix, 'slides'), this.optionsSlides.bind(this));

		this.controller = new SliderController();
		this.controller.interval = _options.interval;
		this.cookie = Date.now();

		SlidesServer._S_emitter.on('slides', this._onNewSlides.bind(this));
	}

	async optionsSlides(this: SlidesServer, request: express.Request, response: express.Response) {
		response.setHeader('Accept', this.mimes.join(', '));
		response.setHeader('Access-Control-Allow-Methods', ['PUT', 'OPTIONS'].join(', '));
		response.sendStatus(200);
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
			return;
		}

		//make temp dir for incoming gif file
		const tmpSlidesPath = await this._makeTmpDir('slides-vik-');

		try {
			const parse = async (request: express.Request) => {
				//write gif file to tmp dir (stream)
				const targetName = 'target-' + this.prefix.replace(new RegExp('\\/', 'gi'), '');
				const targetFilePath = path.join(tmpSlidesPath, targetName);

				await this._writeTargetFile(targetFilePath, request);

				//find md5 hash of loaded file
				//find sha hash of loaded file
				//check if such file already exists in folder project (last loaded promotions) - check both hashes
				const lastPromoFilePath = path.join(this.lastPromotionDir, targetName);
				const isFilesEqual = await this._compareFiles(lastPromoFilePath, targetFilePath);
				if (isFilesEqual) {
					//-- if such file already exists - ignore processing - response 304
					return 304;
				}
				console.log(`[SLIDES][PUT] '${this.prefix}' new promo GIF start processing.`);
				const parserProcess = fork(path.join(__dirname, 'SlideParser.js'), [targetFilePath, this.target], {});
				const parser = this._setupParser(parserProcess);
				parserProcess.send('start');
				return parser;
			};
			//set gif parse task to queue 
			const res = await SlidesServer._parseQueue.enqueue(parse, null, [request]);

			// emit event about new slides
			SlidesServer._S_emitter.emit('slides', this.target, this.cookie);

			console.log(`[SLIDES][PUT] '${this.prefix}' result:`, res);
			if (typeof res === 'number') {
				console.log(`[SLIDES][PUT] '${this.prefix}' new promo is equal with old one. Ignore next processing!`);
				response.sendStatus(res);
				return;
			}

			//fork new child process and register it to queue
			console.log(`[SLIDES][PUT] '${this.prefix}' await this.refresh().`);
			await this.refresh();






			response.sendStatus(200);
		} catch (error) {
			console.log(`[SLIDES][PUT][ERROR] '${this.prefix}'`, error);
			response.sendStatus(500);
		} finally {
			await this._rmDirRecursively(tmpSlidesPath);
		}





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
				(content: string) => !!MimeIs.is(content, this.mimes)
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
			// await this.save(targetFilePath);
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
		let slides = this.controller.slides;
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
		if (!_.isEqual(slides, this.controller.slides)) {
			let running = this.controller.isRunning;
			this.controller.slides = slides;
		}
	}

	_onNewSlides(this: SlidesServer, directoryPath: string, cookie: number) {
		if (this.cookie !== cookie) { // skipping current server
			let directoryIndex = this.sources.indexOf(directoryPath);
			let sourceIndex = typeof this._currentSource === 'string' ? this.sources.indexOf(this._currentSource) : -1;
			if (directoryIndex >= 0 && (sourceIndex < 0 || directoryIndex <= sourceIndex)) {
				this
					.refresh()
					.catch((error: Error) => {
						console.warn(`SlidesServer[${this.cookie} / ${JSON.stringify(this._currentSource)}].refresh(): ${error.name}: ${error.message}`);
					});
			}
		}
	}

	private async _createDir(dirPath: string, mode?: string | number | null | undefined): Promise<void> {
		console.time(`createdir`);
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
		console.timeEnd(`createdir`);
	}

	private _checkContentType(headers: IncomingHttpHeaders): boolean {
		console.time(`checkcontent`);
		let contentType: any = headers['content-type'];
		console.log(`[SLIDES][${this.prefix}] Check content type`, contentType);
		if (
			!_.all(
				((contentType instanceof Array) ? contentType : [contentType]),
				(content: string) => !!MimeIs.is(content, this.mimes)
			)
		) {
			return false;
		}
		console.timeEnd(`checkcontent`);
		return true;
	}

	private async _makeTmpDir(prefix: string): Promise<string> {
		console.time(`makeTmpDir`);
		console.log(`[SLIDES][${this.prefix}] Make temporary dir, prefix:`, prefix);
		const tmpPath = path.join(os.tmpdir(), prefix);
		const result = promisify(fs.mkdtemp)(tmpPath, 'utf8');
		console.timeEnd(`makeTmpDir`);
		return result;
	}

	private async _rmDirRecursively(dir: string): Promise<void> {
		console.time(`rmDirRecursive`);
		console.log(`[SLIDES][${this.prefix}] Remove dir recursively`, dir);
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
		console.timeEnd(`rmDirRecursive`);
	}

	private _writeTargetFile(filePath: string, request: express.Request): Promise<void> {
		console.time(`writeTargetFile`);
		console.log(`[SLIDES][${this.prefix}] Write target file`, filePath);
		const targetStream = fs.createWriteStream(filePath, { autoClose: true });
		request.pipe(targetStream);
		const writeResult = new Promise<void>((resolve, reject) => {
			request.on('error', reject);
			targetStream.on('error', reject);
			targetStream.on('close', resolve);
		});
		console.timeEnd(`writeTargetFile`);
		return writeResult;
	}

	private async _compareFiles(oldFilePath: string, newFilePath: string): Promise<boolean> {
		console.time(`compareFiles`);
		console.log(`[SLIDES][${this.prefix}] Compare files`, oldFilePath, newFilePath);
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
			console.error(`[SLIDES][ERROR] '${this.prefix}' compare files`, error.message);
			result = false;
		}
		console.timeEnd(`compareFiles`);
		return result;
	}

	private _setupParser(parserProcess: ChildProcess): Promise<any> {
		console.time(`parse`);
		console.log(`[SLIDES] '${this.prefix}' Fork parse process.`);
		return new Promise((resolve, reject) => {
			//here we are waiting for message from SlideParser.ts when operation will be finished
			parserProcess.on('message', async (data) => {
				console.log(`[SLIDES] '${this.prefix}' Slides parsing is finished. Data: `, JSON.stringify(data));
				resolve(data);
				console.timeEnd(`parse`);
				parserProcess.kill();
			});
			parserProcess.on('error', (error: Error) => {
				console.log(`FORK ERROR`);
				reject(error);
				parserProcess.kill();
			});
			parserProcess.on('close', (code: number, signal: string) => {
				console.log(`FORK CLOSE`);
				if (code !== 0) {
					reject(code);
				}
				resolve();
			});
		})
	}

	async _load(this: SlidesServer): Promise<ISlide[]> {
		let slides: ISlide[] = [];
		for (let source of this.sources) {
			try {
				slides = await loadSlides(this.prefix, source, this.mimes);
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

	private _validateOptions(options: Partial<ISlideServerOptions> | undefined, _options: ISlideServerOptions) {
		if (typeof options !== 'undefined') {
			if (typeof options !== 'object') {
				throw new TypeError('Instance of object expected as options');
			}
			if (typeof options.prefix !== 'undefined') {
				if (typeof options.prefix !== 'string') {
					throw new TypeError('Instance of string expected as options.prefix');
				}
				else {
					_options.prefix = options.prefix;
				}
			}
			if (typeof options.target !== 'undefined') {
				if (typeof options.target !== 'string') {
					throw new TypeError('Instance of string expected as options.target');
				}
				else {
					_options.target = options.target;
				}
			}
			if (typeof options.sources !== 'undefined') {
				if (!(options.sources instanceof Array && _.all(options.sources, (value) => typeof value === 'string'))) {
					throw new TypeError('Instance of string[] expected as options.sources');
				}
				else {
					_options.sources = options.sources;
				}
			}
			if (typeof options.interval !== 'undefined') {
				if (!(typeof options.interval === 'number' && options.interval > 0)) {
					throw new TypeError('Instance of positive number expected as options.interval');
				}
				else {
					_options.interval = options.interval;
				}
			}
			if (typeof options.mimes !== 'undefined') {
				if (!(options.mimes instanceof Array && _.all(options.mimes, (value) => typeof value === 'string'))) {
					throw new TypeError('Instance of string[] expected as options.mimes');
				}
				else {
					_options.mimes = options.mimes;
				}
			}
			if (typeof options.lastPromotionDir !== 'undefined') {
				if (typeof options.lastPromotionDir !== 'string') {
					throw new TypeError('Instance of string expected as options.lastPromotionDir');
				}
				else {
					_options.lastPromotionDir = options.lastPromotionDir;
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
	const lastPromo = path.join(root, 'lastpromo');

	let secapp = new SlidesServer({
		prefix: '/secondary',
		target: secondary,
		sources: [
			secondary,
			main,
			fallback,
		],
		lastPromotionDir: lastPromo
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
		],
		lastPromotionDir: lastPromo
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
