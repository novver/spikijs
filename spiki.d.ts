/**
 * Interface for the object returned by spiki.mount().
 */
export interface MountedComponent {
    /**
     * Destroys the component and removes event listeners.
     */
    unmount(): void;
}

/**
 * Internal properties injected into 'this' by Spiki.
 */
export interface SpikiInstance {
    /**
     * The root DOM element of the component.
     */
    readonly $root: HTMLElement;

    /**
     * Elements marked with s-ref="name".
     */
    readonly $refs: Record<string, HTMLElement>;

    /**
     * Access to the global reactive store.
     */
    readonly $store: Record<string, any>;

    /**
     * Access to the parent scope (if nested).
     */
    readonly $parent?: any;

    /**
     * Called after mount. Can return a cleanup function.
     */
    init?(): void | (() => void);

    /**
     * Called before the component is destroyed.
     */
    destroy?(): void;

    /**
     * Allows dynamic properties (e.g. variables from s-for).
     */
    [key: string]: any;
}

/**
 * Helper type for the data factory function.
 * Ensures 'this' includes your data + Spiki internals.
 */
export type ComponentFactory<T> = () => T & ThisType<T & SpikiInstance>;

export interface Spiki {
    /**
     * Registers a new component.
     * @param name Name matching 's-data' in HTML.
     * @param factory Function returning the state object.
     */
    data<T extends object>(name: string, factory: ComponentFactory<T>): void;

    /**
     * Scans the document and mounts all components.
     */
    start(): void;

    /**
     * Mounts a specific element manually.
     * Returns the component instance to control it.
     */
    mount(element: Element): MountedComponent | undefined;

    /**
     * Unmounts the component on a specific element.
     */
    unmount(element: Element): void;

    /**
     * Gets a value from the global store.
     */
    store<T = any>(key: string): T;

    /**
     * Sets a value in the global store.
     */
    store<T = any>(key: string, value: T): T;

    /**
     * Returns the original object from a Spiki Proxy.
     */
    raw<T>(object: T): T;
}

declare const spiki: Spiki;
export default spiki;
