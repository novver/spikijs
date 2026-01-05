# ⚡ Spikijs

**Spikijs** is an ultra-lightweight, reactive micro-frontend framework inspired by **Alpinejs**

## ✨ Key Features

*   **🚫 Zero Inline Logic:** No `eval` or `new Function`. Compliant with strict Content Security Policies (CSP). HTML contains only bindings; JS contains logic.
*   **⚡ Fine-Grained Reactivity:** Powered by `Proxy`. Supports deep object nesting and Array mutations (`push`, `splice`, `reverse`) out of the box.
*   **🚀 High Performance:**
    *   **Event Delegation:** Attaches only **one** event listener per event type to the root element, regardless of how many list items you have.
    *   **Optimized List Rendering:** Smart diffing algorithm for `s-for` that reuses DOM nodes and minimizes reflows.
    *   **Memory Efficient:** Uses `WeakMap` for dependency tracking to prevent memory leaks.
*   **🔍 ~5 KB (minify):** Tiny footprint, no build step required.

---

## 📦 Installation

Just import it as a module. No bundler required (though you can use one).

```javascript
import spiki from './spiki.min.js'; // or spiki.js
```

---

## 🏁 Quick Start

### 1. Bind to HTML
Use `s-data` to mount the component and directives to bind data.

```html
<div s-data="counter">
    <h1 s-text="title"></h1>
    <h2 s-text="count"></h2>
    
    <!-- Events map directly to function names in your data -->
    <button s-click="decrement">-</button>
    <button s-click="increment">+</button>
</div>
```

### 2. Define your Logic (JavaScript)
Register a component using `spiki.data`.

```javascript
import spiki from './spiki.min.js';

spiki.data('counter', () => ({
    count: 0,
    title: 'Hello spiki',
    
    increment() {
        this.count++;
    },
    decrement() {
        this.count--;
    }
}));

// Initialize the framework
spiki.start();
```

---

## 📖 Directives Reference

| Syntax | Description | Arguments Passed |
| :--- | :--- | :--- |
| `s-data="name"` | Defines a component scope. Takes the name registered via `spiki.data()`. | - |
| `s-ignore` | Tells Spiki to skip this element and its children during compilation. Useful for integrating 3rd-party libs. | - |
| `s-if="condition"` | Conditionally renders the element. If false, the element is removed from the DOM. | `(el)` |
| `s-for="item in list"` | Loops through an array or object. Must be used on a `<template>` tag. Supports `(item, index) in list`. | - |

### DOM & State Directives

These directives automatically execute the referenced function (if it is one) and pass the current element (`el`) as an argument.

| Syntax | Description | Arguments Passed |
| :--- | :--- | :--- |
| `s-text="prop"` | Updates the element's `textContent`. | `(el)` |
| `s-html="prop"` | Updates the element's `innerHTML`. **⚠️ Use with caution (XSS).** | `(el)` |
| `s-value="prop"` | One-way binding for inputs. Handles `value` for text inputs and `checked` for checkbox/radio. | `(el)` |
| `s-ref="name"` | Registers the element into the `$refs` object of the component (e.g., `this.$refs.name`). | - |
| `s-init="func"` | Lifecycle hook. Runs the function immediately when the element is mounted. Useful for API calls or DOM setup. | `(el)` |

### Attribute Bindings (`:`)

Bindings allow you to make standard HTML attributes reactive.

| Syntax | Description | Arguments Passed |
| :--- | :--- | :--- |
| `:id="uid"`<br>`:disabled="isBusy"` | Binds a generic attribute. If the value is `null`, `undefined`, or `false`, the attribute is removed. | `(el)` |
| `:class="prop"` | **Smart Class Logic:** Expects a string.<br>• Use `"class-name"` to **add**.<br>• Use `"!class-name"` (with `!`) to **remove**.<br><br>*Example:* `return isActive ? 'bg-red' : '!bg-red bg-blue'` | `(el)` |

### Event Listeners (`s-event`)

Any `s-` attribute that is **not** one of the directives above is treated as an event listener.

| Syntax | Description | Arguments Passed |
| :--- | :--- | :--- |
| **`s-[event]`** | Attaches a native event listener (e.g., `s-click`, `s-input`, `s-submit`, `s-mouseenter`).<br>The handler function is **not** auto-executed; it waits for the event trigger. | `(e)`<br>Native Event Object |

---

## 💡 Examples

### 1. Two-Way Binding Logic (Manual)
Since `s-value` is strict one-way binding (Data -> UI), you handle UI updates via events. This gives you full control.

```html
<div s-data="form-app">
    
    <input s-value="message" s-input="sync">
    
    <p>Live preview: <span s-text="message"></span></p>
    
    <button s-click="reset">Reset</button>
</div>

<script type="module">
    import spiki from './spiki.min.js';

    spiki.data('form-app', () => ({
        message: 'Type something...',
        
        sync(e) {
            // Update state from DOM event
            this.message = e.target.value;
        },
        reset() {
            this.message = '';
        }
    }));

    spiki.start();
</script>
```

### 2. Arrays & Loops (`s-for`)
spiki's reactivity system detects Array mutations like `push`.

```html
<div s-data="todo-app">
    <input s-value="newTodo" s-input="syncInput" s-keydown="checkEnter">
    <button s-click="add">Add Task</button>

    <ul>
        <template s-for="task in tasks">
            <li>
                <span s-text="task"></span>
                <!-- Pass the task (object identity) to remove -->
                <button s-click="remove">x</button>
            </li>
        </template>
    </ul>
</div>

<script type="module">
    import spiki from './spiki.min.js';

    spiki.data('todo-app', () => ({
        newTodo: '',
        tasks: ['Buy Milk', 'Sleep'],

        syncInput(e) { this.newTodo = e.target.value; },
        
        checkEnter(e) {
            if(e.key === 'Enter') this.add();
        },

        add() {
            if (!this.newTodo) return;
            // Native array push works and triggers update!
            this.tasks.push(this.newTodo); 
            this.newTodo = '';
        },

        remove(e) {
            // "this" inside an s-for loop inherits the parent scope
            // plus the loop variable (e.g., "task") and "index"
            this.tasks.splice(this.index, 1);
        }
    }));

    spiki.start();
</script>
```

### 3. Refs & Lifecycle
`init()` is a special method that runs when the component mounts.

```html
<div s-data="timer">
    <span s-text="time"></span>
    <button s-ref="btn" s-click="stop">Stop</button>
</div>

<script type="module">
    import spiki from './spiki.min.js';

    spiki.data('timer', () => ({
        time: 0,
        interval: null,

        // Lifecycle hook
        init() {
            console.log('Button ref:', this.$refs.btn);
            this.interval = setInterval(() => {
                this.time++;
            }, 1000);
        },

        stop() {
            clearInterval(this.interval);
        }
    }));

    spiki.start();
</script>
```

### 3. Fetch & Condition
Put `s-if` outside the `<template>`

```html
<div s-data="movie-search">
     <input type="text" s-ref="name" value="black">
     <button s-click="search">search</button>
     <ul s-if="isFound">
         <template s-for="(movie, index) in movies">
             <li>
                 <span s-text="number"></span>
                 <b s-text="movie.Title"></b>
                 (<span s-text="movie.Year"></span>)
             </li>
         </template>
     </ul>
 </div>

<script type="module">
    import spiki from './spiki.min.js';

    spiki.data('movie-search', () => ({
      movies: [],
      isFound: false,
    
      get number(){
          return this.index + 1 + ". ";
      },
    
      async search() {
          const query = this.$refs.name.value;
          if (!query) return;
          
          // API search
          const res = await fetch('https://jsonmock.hackerrank.com/api/movies/search/?Title=' + query);
          const data = await res.json();
    
          this.movies = data.data;
          this.isFound = this.movies.length !== 0;
      }
    }));

    spiki.start();
</script>
```

## ⚙️ Architecture Notes

For those interested in the code:

1.  **Scope Inheritance**: Inside `s-for`, spiki creates a specialized Proxy that reads from the loop item first, then falls back to the parent scope. Writes to non-local keys bubble up to the parent automatically.
2.  **Scheduler**: DOM updates are batched asynchronously using `Promise.resolve().then(...)` (Microtasks), ensuring multiple state changes trigger only one render cycle.
3.  **WeakMap Caching**: The reactivity system caches Proxies. If you access `this.items` multiple times, you get the exact same Proxy reference, ensuring stability in equality checks (`===`).

## License

MIT
