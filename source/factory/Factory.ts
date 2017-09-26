
export interface ITypeMarker<MarkerType> {
	signature: MarkerType;
}

export interface IFactory<TargetType, MarkerType, SourceType extends ITypeMarker<MarkerType>> {
	createInstance(this: IFactory<TargetType, MarkerType, SourceType>, options: SourceType): TargetType;
}

export interface IDelegatedFactory<TargetType, MarkerType, SourceType extends ITypeMarker<MarkerType>>
	extends IFactory<TargetType, MarkerType, SourceType>
{
	readonly delegate: IFactory<TargetType, MarkerType, SourceType>;
}

export class DelegatedFactory<TargetType, MarkerType, SourceType extends ITypeMarker<MarkerType>>
	implements IDelegatedFactory<TargetType, MarkerType, SourceType>
{
	private _delegate: IFactory<TargetType, MarkerType, SourceType>;
	constructor(delegate: IFactory<TargetType, MarkerType, SourceType>) {
		this._delegate = delegate;
	}
	
	get delegate(): IFactory<TargetType, MarkerType, SourceType> {
		return this._delegate;
	}
	
	createInstance(this: DelegatedFactory<TargetType, MarkerType, SourceType>, options: SourceType): TargetType {
		return this._delegate.createInstance(options);
	}
}

export class FunctionDelegatedFactory<TargetType, MarkerType, SourceType extends ITypeMarker<MarkerType>>
	extends DelegatedFactory<TargetType, MarkerType, SourceType>
{
	constructor(delegate: (options: SourceType) => TargetType) {
		super({
			createInstance: delegate
		});
	}
}

export class SingleInstanceFactory<TargetType, MarkerType, SourceType extends ITypeMarker<MarkerType>>
	extends DelegatedFactory<TargetType, MarkerType, SourceType>
{
	private _instance?: TargetType;
	
	constructor(delegate: IFactory<TargetType, MarkerType, SourceType>) {
		super(delegate);
	}
	
	createInstance(this: SingleInstanceFactory<TargetType, MarkerType, SourceType>, options: SourceType): TargetType {
		if (typeof this._instance === 'undefined') {
			return this._instance = super.createInstance(options);
		} else {
			return this._instance;
		}
	}
}
