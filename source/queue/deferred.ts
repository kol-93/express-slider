'use strict';

class _Deferred<ResultType> {
    public readonly promise: Promise<ResultType>;
    public resolve: (value?: ResultType | PromiseLike<ResultType>) => void;
    public reject: (reason?: any) => void;

    public executor(
        this: _Deferred<ResultType>,
        resolve: (value?: ResultType | PromiseLike<ResultType>) => void,
        reject: (reason?: any) => void
    ): void {
        this.resolve = resolve;
        this.reject = reject;
    }

    public constructor() {
        this.promise = new Promise<ResultType>(this.executor.bind(this));
    }
}

const _deferred: WeakMap<any, any> = new WeakMap();

export interface IDeferred<ResultType = any> {
    readonly promise: Promise<ResultType>;
    resolve(value?: ResultType | PromiseLike<ResultType>): void;
    reject(reason?: any): void;
}

export class Deferred<ResultType = any> implements IDeferred<ResultType> {
    public constructor() {
        _deferred.set(this, new _Deferred<ResultType>());
    }

    public get promise(): Promise<ResultType> {
        return (_deferred.get(this) as _Deferred<ResultType>).promise;
    }

    public get resolve(): (value?: ResultType | PromiseLike<ResultType>) => void {
        return (_deferred.get(this) as _Deferred<ResultType>).resolve;
    }

    public get reject(): (reason?: any) => void {
        return (_deferred.get(this) as _Deferred<ResultType>).reject;
    }
}
