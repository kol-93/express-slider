export class GuardCheckError extends Error {
	constructor(message: string, name?: string) {
		super(message);
		if (typeof name === 'string') {
			this.name = name;
		} else {
			this.name = 'GuardCheckError'
		}
	}
}

export interface IGuard<AcceptableType> {
	check(this: IGuard<AcceptableType>, value: AcceptableType): boolean;
	guard<ValueType extends AcceptableType>(this: IGuard<AcceptableType>, value: AcceptableType): value is ValueType;
	assert(this: IGuard<AcceptableType>, value: AcceptableType, message?: string): void;
}

export interface IDelegatedGuard<AcceptableType>
	extends IGuard<AcceptableType>
{
	readonly delegate: IGuard<AcceptableType>;
}

// export class DelegatedGuard<AcceptableType>
// 	implements IDelegatedGuard<AcceptableType>
// {
// 	private _delegate: IGuard<AcceptableType>;
// 	constructor(delegate: IGuard<AcceptableType>) {
// 		this._delegate = delegate;
// 	}
//
// 	get delegate(): IGuard<AcceptableType> {
// 		return this._delegate;
// 	}
//
// 	check(this: DelegatedGuard<AcceptableType>, value: AcceptableType): boolean {
// 		return this._delegate.check(value);
// 	}
//
// 	guard<ValueType extends AcceptableType>(this: DelegatedGuard<AcceptableType>, value: AcceptableType): value is ValueType {
// 		return this._delegate.guard<ValueType>(value);
// 	}
//
// 	assert(this: DelegatedGuard<AcceptableType>, value: AcceptableType, message?: string): void {
// 		this._delegate.assert(value, message);
// 	}
// }
//
