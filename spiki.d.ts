/**
 * Interface representing the context of a Spiki component instance.
 * These properties are automatically injected into the state returned by your factory function.
 */
export interface SpikiContext {
    /**
     * A dictionary of DOM elements marked with `s-ref="name"`.
     * Key is the ref name, value is the HTMLElement.
     */
    $refs: Record<string, HTMLElement>;

    /**
     * The root HTMLElement where the component is mounted.
     */
    $root: HTMLElement;

    /**
     * Direct access to the global reactive store.
     */
    $store: Record<string, any>;

    /**
     * Lifecycle hook: Called immediately after the component is mounted and DOM is processed.
     */
    init?(): void;

    /**
     * Lifecycle hook: Called when the component is being unmounted/destroyed.
     */
    destroy?(): void;

    /**
     * Allows for arbitrary data and methods defined in the component factory.
     */
    [key: string]: any;
}

export interface Spiki {
    /**
     * Registers a new component definition.
     * 
     * @param name - The name of the component (corresponds to `s-data="name"` in HTML).
     * @param factoryFn - A function that returns the initial state object (data and methods).
     * 
     * @example
     * spiki.data('counter', () => ({
     *   count: 0,
     *   increment() { this.count++ }
     * }));
     */
    data(name: string, factoryFn: () => object): void;

    /**
     * Initializes the library.
     * Scans the document for elements with `s-data` attributes and mounts them.
     */
    start(): void;

    /**
     * Retrieves a value from the global reactive store.
     * @param key - The key to retrieve.
     */
    store<T = any>(key: string): T;

    /**
     * Sets a value in the global reactive store.
     * @param key - The key to set.
     * @param value - The value to store.
     * @returns The value that was set.
     */
    store<T>(key: string, value: T): T;

    /**
     * Unwraps a reactive proxy to return the original raw object.
     * Useful for comparing strictly with non-reactive objects or performance optimization.
     * 
     * @param obj - The reactive object (proxy).
     * @returns The original underlying object.
     */
    raw<T>(obj: T): T;
}

declare const spiki: Spiki;

export default spiki;
