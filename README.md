# SpikiJS

SpikiJS is a lightweight (~5KB), high-performance JavaScript framework for building reactive web applications directly in your HTML without build tools. It utilizes ES6 Proxies for fine-grained reactivity and adheres to a strict Content Security Policy (CSP).

📖 **Live Documentation & Demos:** [https://spikijs.pages.dev/](https://spikijs.pages.dev/)

---

## Key Features

- **Tiny Footprint:** Only ~5KB gzip. Works directly in HTML without build tools.
- **100% CSP Secure:** Safe execution without `eval()` or inline expression vulnerabilities.
- **Deep Reactivity:** Automatic tracking for nested objects & arrays using ES6 Proxies.
- **Full SVG Support:** Dynamic attributes and `:class` binding work seamlessly on HTML and SVG.
- **Auto Loop Context:** `s-for` automatically provides `this.item` and `this.index` in event handlers.
- **Global Store + `init()`:** Shared state store that automatically runs an `init()` method on registration.
- **Memory Safe:** Built-in `mount()` and `unmount()` methods to prevent SPA memory leaks.

---

## Directive Rules & CSP Security

SpikiJS enforces strict security and architectural separation of concerns:

1. **No Inline JS Code:** HTML attributes cannot contain JavaScript code, expressions, or operators (e.g. `count++` or `a + b` are invalid).
   - **Allowed Exception:** Boolean directives (`s-if`, `:hidden`, `:disabled`, `:checked`) evaluate state property names directly or with a logical NOT (`!`) operator (e.g. `s-if="isReady"` or `:hidden="!isVisible"`).

2. **No Attribute Parameters:** Function parameters are not supported inside HTML attributes (e.g. `s-click="save(item)"` is invalid).
   - **Correct Pattern:** Bind only the method name (`s-click="save"`). Inside loop templates, Spiki automatically injects context variables directly into `this` (e.g. `this.item`, `this.index`).

3. **No Dot Modifiers:** Attribute names do **NOT** support dots (`.`) or modifier suffixes (e.g. `s-submit.prevent="submitForm"` is invalid).
   - **Correct Pattern:** Bind clean directive names (`s-submit="submitForm"`). Handle event options like `e.preventDefault()` directly inside your JS method.

4. **State Access via `this`:** All data reading and state mutations must be performed inside component methods using the `this` context (e.g. `this.count++`).

---

## Installation

### CDN (Browser)
Include SpikiJS via script tag. Spiki automatically exposes `window.spiki`:

```html
<script src="https://unpkg.com/spikijs"></script>
```

### ES Module / NPM
Install SpikiJS via npm package manager:

```bash
npm install spikijs
```

Import SpikiJS directly as an ES module:

```javascript
import spiki from 'spikijs';
```

---

## Quick Start

```html
<div s-data="counterApp">
    <h2>Count: <span s-text="count"></span></h2>
    <button s-click="increment">+</button>
    <button s-click="decrement">-</button>
</div>

<script type="module">
    import spiki from 'spikijs';

    // 1. Register Component State & Methods
    spiki.data('counterApp', () => ({
        count: 0,
        increment() {
            this.count++;
        },
        decrement() {
            this.count--;
        }
    }));

    // 2. Start Engine
    document.addEventListener('DOMContentLoaded', () => {
        spiki.start();
    });
</script>
```

---

## Directives & API Reference

| Directive / API | Description | Example |
| :--- | :--- | :--- |
| **`s-data`** | Defines component state scope. | `<div s-data="myApp">` |
| **`s-text`** | Sets safe text content. | `<span s-text="username"></span>` |
| **`s-html`** | Sets inner HTML (XSS caution). | `<div s-html="richText"></div>` |
| **`s-if`** | Conditionally mounts/unmounts DOM nodes (supports `!`). | `<div s-if="!isOnline">Offline</div>` |
| **`:hidden`** | Toggles native `hidden` visibility (replaces `s-show`, supports `!`). | `<div hidden :hidden="!isVisible">Content</div>` |
| **`s-for`** | Loops array items inside `<template>` tags. | `<template s-for="(item, idx) in list" s-key="id">` |
| **`s-key`** | Unique key tracking for list items. | `<template ... s-key="id">` |
| **`s-model`** | Two-way input data binding. | `<input s-model="query">` |
| **`s-value`** | One-way value binding. | `<input s-value="formattedText" readonly>` |
| **`s-effect`** | Automatic reactive watcher (runs on state mutations). | `<div s-effect="saveToStorage">` |
| **`s-ref`** | Registers DOM element reference in `this.$refs`. | `<input s-ref="textInput">` |
| **`s-init`** | Executes hook on component mount. | `<div s-init="onMount">` |
| **`s-destroy`** | Executes hook on component unmount. | `<div s-destroy="onUnmount">` |
| **`s-ignore`** | Skips DOM compilation for static blocks. | `<div s-ignore>` |
| **`:[attr]`** | Binds dynamic attributes (HTML & SVG). | `<img :src="userAvatar">` |
| **`:class`** | Binds dynamic classes (HTML & SVG). | `<div :class="activeClass">` |
| **`s-click`** | Listens to native click events and executes component method. | `<button s-click="saveItem">` |
| **`s-[event]`** | Attaches any native event listener (`s-input`, `s-keyup`, `s-change`, etc.). | `<input s-input="handleInput">` |
| **`this.$root`** | Accesses component's root container element. | `this.$root.classList.add('active');` |
| **`this.$refs`** | Object containing all `s-ref` DOM elements. | `this.$refs.textInput.focus();` |
| **`this.$store`** | Accesses registered global stores. | `this.$store.settings.theme` |
| **`spiki.store()`** | Registers global store (runs `init()` automatically if present). | `spiki.store('settings', { theme: 'dark', init() {} })` |
| **`spiki.data()`** | Registers component state with one or more modules/factories. | `spiki.data('app', createAuth, createCart)` |
| **`spiki.raw()`** | Unwraps Spiki Proxy to a plain JavaScript object. | `const plainObj = spiki.raw(this.user);` |

---

## Detailed Feature Documentation

### 1. Conditional Rendering (`s-if`) & Visibility (`:hidden`)

SpikiJS provides two ways to control element display:

- **`s-if`**: Completely mounts or unmounts the element from the DOM tree. Supports negation (`!`).
- **`:hidden`**: Replaces traditional `s-show` by toggling the native `hidden` DOM attribute. Supports negation (`!`).

> **Pro Tip (Prevent FOUC Glitch):** Add the static `hidden` attribute to elements in HTML (`<div hidden :hidden="show">`) so they remain hidden during page load before JS initializes.

```html
<div s-data="visibilityDemo">
    <button s-click="toggle">Toggle Visibility</button>

    <!-- s-if (Mount/Unmount) -->
    <div s-if="isOnline">Status: Online</div>
    <div s-if="!isOnline">Status: Disconnected (Negation Example)</div>

    <!-- :hidden (Visibility Toggle with static hidden attribute to prevent flicker) -->
    <div hidden :hidden="!isVisible">Visible Content</div>
</div>

<script>
spiki.data('visibilityDemo', () => ({
    isOnline: true,
    isVisible: true,
    toggle() {
        this.isOnline = !this.isOnline;
        this.isVisible = !this.isVisible;
    }
}));
</script>
```

---

### 2. SVG & HTML Dynamic Class Binding (`:class`)

Dynamic class binding works seamlessly on both HTML and SVG elements (preventing `SVGAnimatedString` class errors):

```html
<div s-data="themeApp">
    <!-- HTML Element -->
    <div :class="statusClass">Component Active</div>

    <!-- SVG Element -->
    <svg :class="iconClass" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="10"></circle>
    </svg>

    <button s-click="toggleStatus">Toggle Theme</button>
</div>

<script>
spiki.data('themeApp', () => ({
    isActive: false,
    toggleStatus() {
        this.isActive = !this.isActive;
    },
    get statusClass() {
        return this.isActive ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700';
    },
    get iconClass() {
        return this.isActive ? 'stroke-indigo-500 text-indigo-500' : 'stroke-slate-400 text-slate-400';
    }
}));
</script>
```

---

### 3. List Rendering & Scope Auto-Injection (`s-for`)

Inside `<template s-for="(child, index) in children">`, event handlers do **NOT** require parameters. Spiki automatically injects `this.child` (current item) and `this.index` (current loop index) directly into method execution context:

```html
<div s-data="todoApp">
    <input s-model="newItem" s-keyup="checkAdd" placeholder="Add fruit (e.g. Mango)...">
    <button s-click="addItem">Add</button>

    <ul>
        <template s-for="(fruit, idx) in fruits" s-key="id">
            <li>
                #<span s-text="idx"></span>: <span s-text="fruit.name"></span>
                <!-- No parameters needed! this.fruit and this.idx are auto-injected -->
                <button s-click="removeItem">Delete</button>
            </li>
        </template>
    </ul>
</div>

<script>
spiki.data('todoApp', () => ({
    newItem: 'Mango',
    fruits: [
        { id: 1, name: 'Apple' },
        { id: 2, name: 'Banana' }
    ],
    checkAdd(e) {
        if (e.key === 'Enter') this.addItem();
    },
    addItem() {
        if (!this.newItem.trim()) return;
        this.fruits.push({ id: Date.now(), name: this.newItem.trim() });
        this.newItem = '';
    },
    removeItem() {
        // Automatically reads this.idx auto-injected by Spiki loop scope
        if (typeof this.idx === 'number') {
            this.fruits.splice(this.idx, 1);
        }
    }
}));
</script>
```

---

### 4. Instance API: `this.$refs` & `this.$root`

Access raw DOM nodes without query selectors using `this.$refs` and `this.$root`:

```html
<div s-data="refDemo">
    <input s-ref="textInput" type="text" value="Spiki Ref Input">
    <button s-click="focusInput">Focus</button>
    <button s-click="highlightContainer">Highlight Container</button>
</div>

<script>
spiki.data('refDemo', () => ({
    focusInput() {
        // Access raw HTMLInputElement directly
        this.$refs.textInput.focus();
        this.$refs.textInput.select();
    },
    highlightContainer() {
        // Manipulate component container directly
        this.$root.classList.toggle('ring-2');
    }
}));
</script>
```

---

### 5. Global Store (`spiki.store()`) with Auto `init()` Execution

Register shared global state with `spiki.store('name', stateObject)`. If your store defines an `init()` method, Spiki executes `store.init.call(store)` automatically upon registration:

```javascript
// 1. Register store with automatic init hook
spiki.store('settings', {
    theme: 'dark',
    initialized: false,
    init() {
        // Runs automatically when store is registered!
        this.theme = localStorage.getItem('theme') || 'dark';
        this.initialized = true;
    }
});

// 2. Consume store inside any component
spiki.data('headerApp', () => ({
    get currentTheme() {
        return this.$store.settings.theme; // Reactive store subscription!
    },
    toggleTheme() {
        this.$store.settings.theme = this.$store.settings.theme === 'dark' ? 'light' : 'dark';
    }
}));
```

---

### 6. Unwrapping Reactive Proxies (`spiki.raw()`)

Spiki wraps state objects in ES6 Proxies. Use `spiki.raw(proxy)` to unwrap state back into plain JavaScript objects before calling `JSON.stringify()`, logging, or sending network payloads:

```javascript
spiki.data('userProfile', () => ({
    user: { name: 'Alice', role: 'Admin' },
    
    saveUser() {
        // Extract raw, un-proxied JS object
        const plainData = spiki.raw(this.user);
        
        fetch('/api/user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(plainData)
        });
    }
}));
```

---

### 7. Reactive Side Effects (`s-effect`)

Use `s-effect="handler"` to run automatic reactive watchers. 

> **Warning:** Do **NOT** mutate component state properties inside `s-effect` methods (e.g. `this.runs++`), as modifying state read inside an effect causes an infinite loop. Use `s-effect` strictly for external side effects like `localStorage`, network calls, or direct DOM updates.

```html
<div s-data="noteApp" s-effect="autoSave">
    <input type="text" s-model="note">
</div>

<script>
spiki.data('noteApp', () => ({
    note: 'Hello Spiki',
    autoSave() {
        // Pure side effect: read state and write to localStorage
        try {
            localStorage.setItem('user_note', this.note);
        } catch(e) {}
    }
}));
</script>
```

---

### 8. Modular State Composition

For large applications, organize code into smaller modules and pass them directly into `spiki.data()`. It preserves getters, setters, and computed properties while allowing methods across modules to share state via `this`:

```javascript
import spiki from 'spikijs';

const createCounterModule = () => ({
    count: 0,
    increment() { this.count++; }
});

const createThemeModule = () => ({
    darkMode: false,
    toggleTheme() { this.darkMode = !this.darkMode; }
});

// Pass multiple factory functions directly:
spiki.data('app',
    createCounterModule,
    createThemeModule,
    () => ({
        init() {
            console.log('App ready, initial count:', this.count);
        }
    })
);
```

---

## License

MIT License.

