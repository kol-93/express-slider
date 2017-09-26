import {ITypeMarker, IFactory} from "./Factory";

export interface IAbstractFactory<TargetType, MarkerType, SourceType extends ITypeMarker<MarkerType>>
	extends IFactory<TargetType, MarkerType, SourceType>, Map<MarkerType, IFactory<TargetType, MarkerType, SourceType>>
{
}

export class AbstractFactory<TargetType, MarkerType, SourceType extends ITypeMarker<MarkerType>>
	extends Map
	implements IAbstractFactory<TargetType, MarkerType, SourceType>
{
	constructor(another?: Map<MarkerType, IFactory<TargetType, MarkerType, SourceType>>) {
		super();
		if (typeof another !== 'undefined') {
			another.forEach(this.set.bind(this));
		}
	}
	
	createInstance(this: AbstractFactory<TargetType, MarkerType, SourceType>, options: SourceType): TargetType {
		let { signature } = options;
		let delegate = this.get(signature);
		if (typeof delegate === 'undefined') {
			throw new TypeError('Invalid signature');
		} else {
			return delegate.createInstance(options);
		}
	}
}
