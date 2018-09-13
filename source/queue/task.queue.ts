import { EventEmitter } from 'events';
import { Deferred } from './deferred';
import { IQueue } from './queue.interface';

function ignoreError(value: any) {
    return undefined;
}

interface ITask {
    method: Function;
    parameters: any[];
    thisArg: any;
    conditions: Promise<any>[];
    deferred: Deferred<any>;
}

class ThreadExecutor {
    public readonly threadId: number;
    public ready: boolean;
    public promise: Promise<void> | null;

    public constructor(threadId: number) {
        this.threadId = threadId;
        this.ready = true;
        this.promise = null;
    }

    public async run(task: ITask): Promise<void> {
        this.ready = false;
        try {
            this.promise = task.deferred.promise;
            await Promise.all(task.conditions);
            // const thisArg = task.thisArg instanceof Promise ? await task.thisArg : task.thisArg;
            // const parameters = await Promise.all(task.parameters.map((p) => p instanceof Promise ? p : Promise.resolve(p)));
            const result = task.method.apply(task.thisArg, task.parameters);
            if (result instanceof Promise) {
                task.deferred.resolve(await result);
            } else {
                task.deferred.resolve(result);
            }
        } catch (error) {
            task.deferred.reject(error);
        } finally {
            this.ready = true;
            this.promise = null;
        }
    }
}

class _TaskQueue extends EventEmitter {
    private _limit: number;

    public readonly tasks: ITask[];
    public readonly ready: Set<ThreadExecutor>;
    public readonly busy: Set<ThreadExecutor>;

    public constructor(limit: number, threads: number) {
        super();
        this._limit = limit;

        this.tasks = [];
        this.ready = new Set<ThreadExecutor>();
        this.busy = new Set<ThreadExecutor>();
        for (let i = 0; i !== threads; ++i) {
            this.ready.add(new ThreadExecutor(i));
        }
    }

    private _loop(this: _TaskQueue, executor: ThreadExecutor) {
        const task = this.tasks.shift();
        if (task) {
            const wasReady = this.isReady;
            this.ready.delete(executor);
            this.busy.add(executor);
            executor.run(task)
                .then(() => process.nextTick(this._loop.bind(this, executor)));
            if (wasReady) {
                this.emit('busy');
            }
        } else {
            const wasReady = this.isReady;
            this.busy.delete(executor);
            this.ready.add(executor);
            if (wasReady !== this.isReady) {
                this.emit('ready');
            }
            if (this.busy.size === 0) {
                this.emit('finish');
            }
        }
    }

    public push(this: _TaskQueue, task: ITask): boolean {
        if (this._limit < 0 || this.size < this._limit) {
            this.tasks.push(task);
            const it = this.ready[Symbol.iterator]();
            const threadIt = it.next();
            if (!threadIt.done && threadIt.value) {
                process.nextTick(this._loop.bind(this, threadIt.value));
            }
            return true;
        } else {
            return false;
        }
    }

    public finish(this: _TaskQueue): Promise<void> {
        this._limit = 0;
        return Promise.all(([] as Promise<any>[]).concat(
            this.tasks.map((task) => task.deferred.promise.then(ignoreError, ignoreError)),
            Array.from(this.ready.values()).filter((executor) => executor.promise).map((executor) => (executor.promise as Promise<any>).then(ignoreError, ignoreError)),
            Array.from(this.busy.values()).filter((executor) => executor.promise).map((executor) => (executor.promise as Promise<any>).then(ignoreError, ignoreError)),
        )) as Promise<any>;
    }

    public get isReady(this: _TaskQueue): boolean {
        return this.ready.size !== 0;
    }

    public get size(this: _TaskQueue): number {
        return this.tasks.length + this.busy.size;
    }

    public get limit(this: _TaskQueue): number {
        return this._limit;
    }
}

const _queue = new WeakMap<Queue, _TaskQueue>();
export class Queue extends EventEmitter implements IQueue {
    public constructor(limit: number, threads: number) {
        super();
        const __this = new _TaskQueue(limit, threads);
        _queue.set(this, __this);
        __this.on('ready', this.emit.bind(this, 'ready'));
        __this.on('busy', this.emit.bind(this, 'busy'));
        __this.on('finish', this.emit.bind(this, 'finish'));
    }

    public get size(this: Queue): number {
        const __this = (_queue.get(this) as _TaskQueue);
        return __this.size;
    }

    public get limit(this: Queue): number {
        const __this = (_queue.get(this) as _TaskQueue);
        return __this.limit;
    }

    public get isReady(this: Queue): boolean {
        const __this = (_queue.get(this) as _TaskQueue);
        return __this.isReady;
    }

    public get threads(this: Queue): number {
        const __this = (_queue.get(this) as _TaskQueue);
        return __this.busy.size + __this.ready.size;
    }

    public enqueue<ThisType, ResultType>(this: Queue, method: (this: ThisType, ...args: any[]) => Promise<ResultType>, thisArg: ThisType, parameters?: any[], conditions?: Promise<any>[]): Promise<ResultType> {
        const deferred = new Deferred<ResultType>();
        const task: ITask = {
            method,
            parameters: parameters || [],
            thisArg,
            conditions: conditions || [],
            deferred,
        };
        const __this = (_queue.get(this) as _TaskQueue);
        if (__this.push(task)) {
            return deferred.promise;
        } else {
            return Promise.reject(new Error('Queue size overflow'));
        }
    }

    public finish(this: Queue): Promise<void> {
        const __this = (_queue.get(this) as _TaskQueue);
        return __this.finish();
    }
}
