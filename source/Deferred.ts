
export type ResolveFunction<ResultType> = (arg: ResultType) => void;
export type RejectFunction<ErrorType extends Error> = (err: ErrorType) => void;
export type SafeCallbackFunction = (...args: any[]) => void;
export type UnsafeCallbackFunction<ErrorType extends Error> = (error?: ErrorType, ...rest: any[]) => void;


export class Deferred<ErrorType extends Error, ResultType extends any[]> {
	private _resolve: ResolveFunction<ResultType>;
	private _reject: RejectFunction<ErrorType>;
	private _promise: Promise<ResultType>;
	private __safe?: SafeCallbackFunction;
	private __unsafe?: UnsafeCallbackFunction<ErrorType>;
	
	constructor(){
		this._promise = new Promise<ResultType>(this._saveCalls.bind(this));
	}
	
	_saveCalls(resolve: ResolveFunction<ResultType>, reject: RejectFunction<ErrorType>) {
		this._resolve = resolve;
		this._reject = reject;
	}
	
	_safe(this: Deferred<ErrorType, ResultType>, ...rest: any[]): void {
		this._resolve.call(undefined, rest);
	}
	
	_unsafe(this: Deferred<ErrorType, ResultType>, error: ErrorType, ...rest: any[]): void {
		if (error instanceof Error) {
			this._reject(error);
		} else {
			this._resolve.call(undefined, rest);
		}
	}
	
	get safe(): SafeCallbackFunction {
		if (this.__safe === undefined) {
			return this.__safe = this._safe.bind(this);
		} else {
			return this.__safe;
		}
	}
	
	get unsafe(): UnsafeCallbackFunction<ErrorType> {
		if (this.__unsafe === undefined) {
			return this.__unsafe = this._unsafe.bind(this);
		} else {
			return this.__unsafe;
		}
	}
	
	get promise(): Promise<ResultType> {
		return this._promise;
	}
	
	get resolve(): ResolveFunction<ResultType> {
		return this._resolve;
	}
	
	get reject(): RejectFunction<ErrorType> {
		return this._reject;
	}
}
