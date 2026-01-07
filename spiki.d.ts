/**
 * Interface representing the internal properties injected by Spiki.
 * These are available via 'this' inside your component.
 */
export interface SpikiInstance {
    /**
     * The root DOM element of the component (the one with s-data).
     */
    readonly $root: HTMLElement;

    /**
     * References to DOM elements marked with `s-ref`.
     * Example: <input s-ref="box"> becomes this.$refs.box
     */
    readonly $refs: Record<string, HTMLElement>;

    /**
     * Access to the global reactive store.
     */
    readonly $store: Record<string, any>;

    /**
     * Lifecycle hook: Called immediately after the component is mounted.
     */
    init?(): void;

    /**
     * Lifecycle hook: Called when the component is removed from the DOM.
     */
    destroy?(): void;

    /**
     * Index signature to allow dynamic properties.
     * This prevents TypeScript errors when accessing variables 
     * injected by 's-for' loops (e.g., this.item, this.index).
     */
    [key: string]: any;
}

/**
 * Type helper for the data factory.
 * It ensures 'this' inside your methods includes both your data 
 * and Spiki's internal properties ($refs, $root, etc).
 */
type ComponentFactory<T> = () => T & ThisType<T & SpikiInstance>;

interface Spiki {
    /**
     * Registers a new component.
     * 
     * @param name The name matching the 's-data' attribute in HTML.
     * @param factory A function that returns the initial state object.
     */
    data<T extends object>(name: string, factory: ComponentFactory<T>): void;

    /**
     * Starts the Spiki engine.
     * Scans the DOM for 's-data' elements and mounts them.
     */
    start(): void;

    /**
     * Retrieves a value from the global store.
     */
    store<T = any>(key: string): T;

    /**
     * Sets a value in the global store.
     */
    store<T = any>(key: string, value: T): T;
}

declare const spiki: Spiki;
export default spiki;
