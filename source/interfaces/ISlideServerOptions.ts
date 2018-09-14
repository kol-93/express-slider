
export interface ISlideServerOptions {
    prefix: string;
    target: string;
    sources: string[];
    interval: number;
    mimes: string[];
    lastSliderDir: string; //dir where saved last loaded '*.gif' file with promotions 
}
