# Spikijs

**Spikijs** is a lightweight, reactive JavaScript framework that binds data directly to your HTML without a Virtual DOM. It uses ES6 Proxies for high-performance state management and a simple attribute-based syntax. Inspired by **Alpinejs**

## Key Features

*   **~2.5 KB (Gzip):** Tiny footprint, no build step required.

*   **Zero Inline Logic:** Compliant with strict Content Security Policies (CSP). HTML contains only bindings; JS contains logic.

*   **High Performance:** Event Delegation, Optimized List Rendering, Memory Efficient

---

## Installation

### NPM
Install the package via npm:
```bash
npm install spikijs
```

Import it into your module:
```javascript
import spiki from 'spikijs';
```

### CDN (Browser)
You can drop Spiki directly into your HTML file using the script tag:

```html
<script src="https://unpkg.com/spikijs@1.0.1/spiki.min.js"></script>
```

---

## Quick Start

1.  **Define HTML**: Add `s-data="appName"` to a container.
2.  **Define Logic**: Use `spiki.data()`.
3.  **Start Engine**: Call `spiki.start()`.

```html
<div s-data="counterApp">
    <h1>Count: <span s-text="count"></span></h1>
    <button s-click="increment">Add +1</button>
</div>

<script>
    spiki.data('counterApp', () => ({
        count: 0,
        increment() {
            this.count++;
        }
    }));

    spiki.start();
</script>
```
## Directives Reference

Quick reference table summarizing all Spikijs syntaxes.

| Syntax | Description | Usage Example |
| :--- | :--- | :--- |
| **`s-data`** | Defines the scope of a component. Matches the name registered in `spiki.data`. | `<div s-data="myApp">...</div>` |
| **`s-text`** | Updates the element's text content with the variable value. | `<span s-text="username"></span>` |
| **`s-html`** | Updates the element's inner HTML (use trusted content only). | `<div s-html="rawContent"></div>` |
| **`s-if`** | Conditionally renders the element. Removes it from DOM if false. | `<p s-if="isLoggedIn">Welcome!</p>` |
| **`s-for`** | Iterates over an Array or Object. | `<li s-for="(item, i) in list">...</li>` |
| **`s-key`** | (Optional) Unique key for `s-for` items to optimize rendering. | `<li s-for="user in users" s-key="id">` |
| **`s-model`** | Two-way binding for inputs, selects, and textareas. | `<input s-model="email">` |
| **`s-value`** | One-way binding for input values (State -> DOM only). | `<input s-value="calculatedResult" readonly>` |
| **`s-ref`** | Stores a reference to the DOM element in `this.$refs`. | `<input s-ref="myBox">`<br>JS: `this.$refs.myBox.focus()` |
| **`:[attr]`** | Dynamically binds an HTML attribute. Returns `false` to remove. | `<button :disabled="isProcessing">Save</button>` |
| **`:class`** | Dynamically toggles CSS classes. Prefix with `!` to remove. | `<div :class="statusClass"></div>`<br>JS returns: `"active"` or `"!active"` |
| **`s-[event]`** | Listens for DOM events (click, submit, input, etc.). | `<button s-click="handleClick">Go</button>` |
| **`s-ignore`** | Skips compilation for this element and its children. | `<div s-ignore><div id="map"></div></div>` |
| **`s-init`** | Expression runs when the element is mounted. | `<div s-init="console.log('Loaded')"></div>` |
| **`s-destroy`** | Expression runs when the element is removed. | `<div s-destroy="console.log('Removed')"></div>` |
| **`init()`** | **JS Lifecycle**: Method called after component mounts. | `init() { console.log('Ready'); }` |
| **`destroy()`** | **JS Lifecycle**: Method called when component unmounts. | `destroy() { console.log('Gone'); }` |
| **`this.$root`** | **JS Property**: Access the root DOM element of the component. | `this.$root.classList.add('loaded');` |
| **`this.$store`** | **JS Property**: Access the global reactive store. | `this.$store.user.name` |
| **`spiki.store()`** | **Global API**: Get or set global shared data. | `spiki.store('theme', 'dark')` |

---

## Core API

### `spiki.data(name, factory)`
Registers a component.
*   **name**: Must match the `s-data` attribute in HTML.
*   **factory**: A function returning the initial object state.

### `spiki.start()`
Initializes the library and mounts all elements found with `s-data`.

### `spiki.store(key, value?)`
Access the global state shared across components.
```javascript
// Set
spiki.store('user', { name: 'John' });

// Get
const user = spiki.store('user');
```

---

## Directives & Features

### `s-data`
Defines the scope of a component. All reactivity happens within this element.

```html
<div s-data="profile">
    <!-- Component content -->
</div>
```

### `s-text`
Updates the element's text content.

```html
<div s-data="example">
    <p>Hello, <span s-text="username"></span></p>
</div>
<script>
    spiki.data('example', () => ({ username: 'Alice' }));
</script>
```

### `s-html`
Updates the element's inner HTML. **Use with caution** (only trusted content).

```html
<div s-data="example">
    <div s-html="content"></div>
</div>
```
```javascript
spiki.data('example', () => ({
    content: '<b>Bold Text</b>'
}));
```

### `s-if`
Conditionally renders an element. If the value is `false`, the element is removed from the DOM.

```html
<div s-data="toggleApp">
    <button s-click="toggle">Toggle Message</button>

    <p s-if="isVisible">Now you see me!</p>
</div>
```
```javascript
spiki.data('toggleApp', () => ({

    isVisible: true,

    toggle() { 
        this.isVisible = !this.isVisible;
    }
}));
```

### `s-for`
Iterates over Arrays or Objects. Supports optional `s-key` for performance.

```html
<div s-data="listApp">
    <ul>
        <!-- syntax: (item, index) in array -->
        <li s-for="(todo, i) in todos" s-key="id">
            <span s-text="i"></span> - <span s-text="todo.text"></span>
        </li>
    </ul>

    <button s-click="add">Add Item</button>
</div>

```
```javascript
spiki.data('listApp', () => ({

    todos: [
        {id: 1, text: 'Eat'},
        {id: 2, text: 'Sleep'}
    ],

    add() {
        this.todos.push({ id: Date.now(), text: 'Code' });
    }
}));
```


### `s-model`
Two-way data binding for form inputs (`input`, `textarea`, `select`).

```html
<div s-data="formApp">
    <input type="text" s-model="message" placeholder="Type here...">

    <p>Preview: <span s-text="message"></span></p>
</div>
```
```javascript
spiki.data('formApp', () => ({ 

    message: ''
}));
```

### `s-[event]` (Event Listeners)
Listens to DOM events. You can use any valid DOM event name (e.g., `s-click`, `s-submit`, `s-mouseenter`).

```html
<div s-data="eventApp">
    <button s-click="sayHello" s-mouseenter="onHover">Hover or Click</button>
</div>
```
```javascript
spiki.data('eventApp', () => ({

    sayHello(e) {
        alert('Clicked!');
    },

    onHover(e) {
        console.log('Hovered', e.target);
    }
}));
```

### `:[attribute]` (Dynamic Attributes)
Binds an attribute to a variable. Prefix with `:`.

```html
<div s-data="attrApp">
    <button :disabled="isBusy">Submit</button>

    <a :href="link">Go to Google</a>
</div>
```
```javascript
spiki.data('attrApp', () => ({

    isBusy: true,

    link: 'https://google.com'
}));
```

### `:class`
Dynamically toggles classes.
*   Spiki expects a string of classes.
*   To **remove** a class, prefix it with `!`.

```html
<div s-data="classApp">
    <!-- If isActive is true, class is 'box active'. If false, 'box' -->
    <div class="box" :class="statusClass"></div>

    <button s-click="toggle">Toggle Class</button>
</div>
```
```javascript
spiki.data('classApp', () => ({

    isActive: false,

    toggle() { 
        this.isActive = !this.isActive;
    },
    
    // Use a getter to return the logic
    get statusClass() {
        return this.isActive ? 'active' : '!active';
    }
}));
```

### `s-ref`
Stores a reference to a DOM element in `this.$refs`.

```html
<div s-data="refApp">
    <input type="text" s-ref="emailInput">

    <button s-click="focusInput">Focus Input</button>
</div>
```
```javascript
spiki.data('refApp', () => ({
    
    focusInput() {
        // Access the raw DOM element
        this.$refs.emailInput.focus();
    }
}));
```

### `s-ignore`
Tells Spiki to skip compiling this element and its children. Useful for integrating third-party libraries (like maps or charts).

```html
<div s-ignore>
    <div id="map"></div> <!-- Spiki will not touch this -->
</div>
```

### `s-value`
One-way binding to set the `value` property of an input without listening for changes (unlike `s-model`).

```html
<input s-value="calculatedResult" readonly>
```

### `s-init`
Runs an expression when the element is mounted.

```html
<div s-init="console.log('Element loaded')"></div>
```

---

## JavaScript Instance (`this`)

Inside your data functions, `this` refers to the reactive component state.

### Return Types
Spiki supports different types of values in your data object:

1.  **Variables**: Simple data (`this.count`).
2.  **Functions**: Methods (`this.doSomething()`).
3.  **Getters**: Computed properties.

```javascript
spiki.data('types', () => ({

    firstName: 'John',
    lastName: 'Doe',
    
    // Getter (Computed)
    get fullName() {
        return this.firstName + ' ' + this.lastName;
    }
}));
```

### Special Properties

1.  **`this.$root`**: The root DOM element of the component.
2.  **`this.$refs`**: Access elements marked with `s-ref`.
3.  **`this.$store`**: Access the global store.

### Loop Context (Inside `s-for`)
When using `s-for`, the scope is inherited. You can access the current item and index via `this` inside function calls triggered from within the loop.

```html
<li s-for="(item, i) in list">
    <span s-text="item"></span>

    <button s-click="removeMe">x</button>
</li>
```

```javascript
removeMe() {

    // 'this.i' is automatically available here
    this.list.splice(this.i, 1);
}
```

### Lifecycle Hooks
Define these methods in your data object to run code at specific times.

*   **`init()`**: Runs after the component is mounted.
*   **`destroy()`**: Runs when the component is removed (unmounted).

```javascript
spiki.data('lifecycle', () => ({

    init() {
        console.log('Component is ready!');
        this.interval = setInterval(() => this.tick(), 1000);
    },

    destroy() {
        clearInterval(this.interval);
        console.log('Component removed!');
    }
}));
```
