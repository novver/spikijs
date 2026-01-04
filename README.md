# ⚡ Spikijs

**Spikijs** is an ultra-lightweight, reactive micro-frontend framework inspired by **Alpinejs**

## ✨ Key Features

*   **🚫 Zero Inline Logic:** No `eval` or `new Function`. Compliant with strict Content Security Policies (CSP). HTML contains only bindings; JS contains logic.
*   **⚡ Fine-Grained Reactivity:** Powered by `Proxy`. Supports deep object nesting and Array mutations (`push`, `splice`, `reverse`) out of the box.
*   **🚀 High Performance:**
    *   **Event Delegation:** Attaches only **one** event listener per event type to the root element, regardless of how many list items you have.
    *   **Optimized List Rendering:** Smart diffing algorithm for `_for` that reuses DOM nodes and minimizes reflows.
    *   **Memory Efficient:** Uses `WeakMap` for dependency tracking to prevent memory leaks.
*   **🔍 ~2KB (Gzipped):** Tiny footprint, no build step required.

---

## 📦 Installation

Just import it as a module. No bundler required (though you can use one).

```javascript
import spiki from './spiki.min.js'; // or spiki.js
```

---

## 🏁 Quick Start

### 1. Bind to HTML
Use `_data` to mount the component and directives to bind data.

```html
<div _data="counter">
    <h1 _text="title"></h1>
    <h2 _text="count"></h2>
    
    <!-- Events map directly to function names in your data -->
    <button _click="decrement">-</button>
    <button _click="increment">+</button>
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

### State & display
| Directive | Description |
| :--- | :--- |
| `_data="name"` | Mounts a component defined in `spiki.data`. |
| `_text="key"` | Updates `textContent` based on data. |
| `_html="key"` | Updates `innerHTML` (use carefully). |
| `_ignore` | Skips compilation for this element and its children (performance). |

### Bindings
| Directive | Description |
| :--- | :--- |
| `_value="key"` | **One-way binding** from State to Input (`value`, `checked`). Ideal for controlled inputs. |
| `:attr="key"` | Dynamic attribute binding. <br>Example: `:class="myClass"`, `:href="item.url"`, `:disabled="isBusy"`. |
| `_ref="name"` | Stores the DOM element in `this.$refs.name`. |

### Flow Control
| Directive | Description |
| :--- | :--- |
| `_if="condition"` | Conditionally renders the element. If false, the element is removed from the DOM. |
| `_for="item in list"`<br>`_for="(item, index) in list"` | Loops over arrays. Must be used on a `<template>` tag. <br>In function you can access `this.item`, `this.index` |

### Events
| Directive | Description |
| :--- | :--- |
| `_event="method"` | Listens for events (`click`, `input`, `submit`, etc.). calls the method in your scope. <br>Example: `_click="method"`, `_submit="method"`. |

---

## 💡 Examples

### 1. Two-Way Binding Logic (Manual)
Since `_value` is strict one-way binding (Data -> UI), you handle UI updates via events. This gives you full control.

```html
<div _data="form-app">
    <!-- 1. State controls the input value -->
    <!-- 2. Input event updates the state -->
    <input _value="message" _input="sync">
    
    <p>Live preview: <span _text="message"></span></p>
    
    <button _click="reset">Reset</button>
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

### 2. Arrays & Loops (`_for`)
spiki's reactivity system detects Array mutations like `push`.

```html
<div _data="todo-app">
    <input _value="newTodo" _input="syncInput" _keydown="checkEnter">
    <button _click="add">Add Task</button>

    <ul>
        <template _for="task in tasks">
            <li>
                <span _text="task"></span>
                <!-- Pass the task (object identity) to remove -->
                <button _click="remove">x</button>
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
            // "this" inside an _for loop inherits the parent scope
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
<div _data="timer">
    <span _text="time"></span>
    <button _ref="btn" _click="stop">Stop</button>
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
Put `_if` outside the `<template>`

```html
<div _data="movie-search">
     <input type="text" _ref="name" value="black">
     <button _click="search">search</button>
     <ul _if="isFound">
         <template _for="(movie, index) in movies">
             <li>
                 <span _text="number"></span>
                 <b _text="movie.Title"></b>
                 (<span _text="movie.Year"></span>)
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

1.  **Scope Inheritance**: Inside `_for`, spiki creates a specialized Proxy that reads from the loop item first, then falls back to the parent scope. Writes to non-local keys bubble up to the parent automatically.
2.  **Scheduler**: DOM updates are batched asynchronously using `Promise.resolve().then(...)` (Microtasks), ensuring multiple state changes trigger only one render cycle.
3.  **WeakMap Caching**: The reactivity system caches Proxies. If you access `this.items` multiple times, you get the exact same Proxy reference, ensuring stability in equality checks (`===`).

## License

MIT
