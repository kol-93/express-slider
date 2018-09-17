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
			lastSliderDir: path.join(os.tmpdir(), 'last-slide')
		};
	}

	private _currentSource?: string;

	readonly express: express.Express;
	readonly target: string;
	readonly sources: string[];
	readonly prefix: string;
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
		this.lastPromotionDir = _options.lastSliderDir;
		this._createDir(this.lastPromotionDir, 0o644);
		this.express.get(path.posix.join(prefix, 'slides', ':id', ':modified'), this.serveSlide.bind(this));
		this.express.get(path.posix.join(prefix, 'slides', ':id'), this.serveSlide.bind(this));
		this.express.put(path.posix.join(prefix, 'slides'), this.putSlides.bind(this));
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

	async putSlides(this: SlidesServer, request: express.Request, response: express.Response) {
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
		const tmpSlidesPath = await this._makeTmpDir('slides-');

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
				const resultSlidesDir = path.join(tmpSlidesPath, 'slides');
				//create temporary directory for saving new slides '/tmp/.../slides'
				await this._createDir(resultSlidesDir, 0o644);
				const parserProcess = fork(path.join(__dirname, 'SlideParser.js'), [targetFilePath, resultSlidesDir], {});
				const parser = this._setupParser(parserProcess, targetFilePath, resultSlidesDir, this.lastPromotionDir, this.target);
				parserProcess.send('start');
				return parser;
			};

			//fork new child process and register it to queue
			const res = await SlidesServer._parseQueue.enqueue(parse, null, [request]);

			console.log(`[SLIDES][PUT] '${this.prefix}' result:`, res);
			if (typeof res === 'number' && res === 304) {
				console.log(`[SLIDES][PUT] '${this.prefix}' new promo is equal with old one. Ignore next processing!`);
				response.sendStatus(304);
				return;
			}

			// emit event about new slides
			SlidesServer._S_emitter.emit('slides', this.target, this.cookie);

			//refresh slider
			console.log(`[SLIDES][PUT] '${this.prefix}' await this.refresh().`);
			await this.refresh();

			//send response 200 if success
			response.sendStatus(200);
		} catch (error) {
			//if error send response 500
			console.log(`[SLIDES][PUT][ERROR] '${this.prefix}'`, error);
			response.sendStatus(500);
		}

		//delete temporary directory
		try {
			await this._rmDirRecursively(tmpSlidesPath);
		} catch (error) {
			console.error(`[SLIDES][PUT][ERROR] '${this.prefix}' Cant remove temporary dir recursively:`, error.message);
		}

		console.log(`[SLIDES][PUT] Complete.`);
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
			console.error(`[SLIDES][WARN] '${this.prefix}' compare files`, error.message);
			result = false;
		}
		console.timeEnd(`compareFiles`);
		return result;
	}

	private async _setupParser(parserProcess: ChildProcess, source: string, target: string, lastSlidesDir: string, slidesWorkDir: string): Promise<any> {
		console.time(`parse`);
		console.log(`[SLIDES] '${this.prefix}' Fork parse process.`);
		const result = await new Promise((resolve, reject) => {
			//here we are waiting for message from SlideParser.ts when operation will be finished
			parserProcess.on('message', async (data) => {
				console.log(`[SLIDES] '${this.prefix}' Slides parsing is finished. Data: `, JSON.stringify(data));
				switch (data) {
					case 500: reject(500); break;
					default: resolve(data);
				}
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
		});

		try {
			//copy file to storage of last loaded file '/..../last-slider'
			console.log(`[SLIDES][${this.prefix}] Move GIF file to storage of last loaded file '/..../last-slider'...`);
			await this._moveFile(source, lastSlidesDir);
			//delete old slides from work directory '/...../public/media/slides/{main,secondary}....'
			console.log(`[SLIDES][${this.prefix}] Delete old slides from working directory '/...../public/media/slides/{main,secondary}....'`);
			await this._clearOldSlides(/*slidesWorkDir*/);
			//move new slides from tmp directory to project directory '/...../public/media/slides/{main,secondary}....
			console.log(`[SLIDES][${this.prefix}] Move new slides from tmp directory to project directory '/...../public/media/slides/{main,secondary}....'`);
			await this._moveSlides(target, slidesWorkDir);
		} catch (error) {
			console.log(`[SLIDES][${this.prefix}][ERROR]`, error.message);
			const name = path.basename(source);
			console.log(`[SLIDES][${this.prefix}] Delete GIF file from storage of last loaded file '/..../last-slider'...`);
			await promisify(fs.unlink)(path.join(lastSlidesDir, name));
		}

		return result;
	}

	private _moveFile(sourceFilePath: string, lastPromoDir: string): Promise<void> {
		const name = path.basename(sourceFilePath);
		const destFilePath = path.join(lastPromoDir, name);
		return promisify(fs.rename)(sourceFilePath, destFilePath);
	}

	private async _clearOldSlides(): Promise<void[]> {
		const slideNames = this.controller.slides.map(slide => slide.path);
		const deletePromises = slideNames.map(slide => promisify(fs.unlink)(slide));
		return await Promise.all(deletePromises);
	}

	private async _moveSlides(targetDirPath: string, workDir: string): Promise<void[]> {
		const slideNames = (await loadSlides(this.prefix, targetDirPath, this.mimes)).map(slide => slide.path);
		const movePromises = slideNames.map(slide => this._moveFile(slide, workDir));
		return await Promise.all(movePromises);
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
			if (typeof options.lastSliderDir !== 'undefined') {
				if (typeof options.lastSliderDir !== 'string') {
					throw new TypeError('Instance of string expected as options.lastPromotionDir');
				}
				else {
					_options.lastSliderDir = options.lastSliderDir;
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
	const lastSlider = path.join(root, 'last-slider');

	let secapp = new SlidesServer({
		prefix: '/secondary',
		target: secondary,
		sources: [
			secondary,
			main,
			fallback,
		],
		lastSliderDir: lastSlider
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
		lastSliderDir: lastSlider
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
