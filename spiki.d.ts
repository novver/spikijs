export interface MountedComponent {
    unmount(): void;
}

export interface SpikiInstance {
    readonly $root: HTMLElement;
    readonly $refs: Record<string, HTMLElement>;
    readonly $store: Record<string, any>;
    readonly $parent?: any;
    init?(): void | (() => void);
    destroy?(): void;
    [key: string]: any;
}

export type ComponentFactory<T> = () => T & ThisType<T & SpikiInstance>;

export interface Spiki {
    data<T extends object>(name: string, factory: ComponentFactory<T>): void;
    start(): void;
    mount(element: Element): MountedComponent | undefined;
    unmount(element: Element): void;
    store<T = any>(key: string): T;
    store<T = any>(key: string, value: T): T;
    raw<T>(object: T): T;
}

declare const spiki: Spiki;
export default spiki;