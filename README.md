# Spikijs

Spikijs is a lightweight (~5KB), high-performance JavaScript framework for building interactive interfaces. It works directly with your HTML (no build step required) and uses ES6 Proxies for reactive state management.

It is designed to be simple, secure (CSP Compliant), and fast.

## Key Features

* **Tiny Footprint:** Around 5KB gzip. No complex bundlers needed.
* **Zero Inline Logic:** You cannot write JavaScript logic in HTML attributes (e.g., `count++` is forbidden). This enforces clean separation of concerns and complies with strict Content Security Policies (CSP).
* **Deep Reactivity:** Automatically tracks changes in nested objects and arrays using Proxies.
* **Memory Safe:** Explicit `mount()` and `unmount()` methods prevent memory leaks in Single Page Applications.

---

## Installation

### Option 1: CDN (Browser)
Simply add the script tag to your HTML.
```html
<script src="https://unpkg.com/spikijs"></script>

```

### Option 2: NPM

```bash
npm install spikijs

```

```javascript
import spiki from 'spikijs';
spiki.start();

```

---

## Quick Start

1. **Define HTML**: Add `s-data` to a container.
2. **Define Logic**: Use `spiki.data()`.
3. **Start Engine**: Call `spiki.start()`.

```html
<div s-data="counterApp">
    <h1>Count: <span s-text="count"></span></h1>
    <button s-click="increment">Add +1</button>
    <button s-click="decrement">Remove +1</button>
</div>

<script src="https://unpkg.com/spikijs"></script>
<script>
// 1. Register Component
spiki.data('counterApp', ()=>({
    count: 0,
    increment() {
        this.count++;
    },
    decrement() {
        this.count--;
    }
}));

// 2. Start Spiki
document.addEventListener('DOMContentLoaded', ()=>{
    spiki.start();
});
</script>

```

---

## Directives Reference

| Directive | Description | Example |
| --- | --- | --- |
| **`s-data`** | Defines component scope. | `<div s-data="app">` |
| **`s-text`** | Sets text content (Safe). | `<span s-text="msg">` |
| **`s-html`** | Sets innerHTML (Use carefully). | `<div s-html="htmlContent">` |
| **`s-if`** | Conditional rendering. | `<p s-if="showMe">` |
| **`s-for`** | Loops content (requires `<template>`). | `<template s-for="item in list">` |
| **`s-key`** | Unique key for loops (Performance). | `<template ... s-key="id">` |
| **`s-model`** | Two-way binding (Inputs). | `<input s-model="text">` |
| **`s-value`** | One-way value binding. | `<input s-value="text">` |
| **`s-effect`** | Runs function on data change. | `<div s-effect="autoSave">` |
| **`s-ref`** | Stores DOM reference in `$refs`. | `<input s-ref="myInput">` |
| **`s-init`** | Runs on mount. | `<div s-init="onLoad">` |
| **`s-ignore`** | Skips compilation (Static content). | `<div s-ignore>` |
| **`:[attr]`** | Dynamic attribute binding. | `<img :src="imgUrl">` |
| **`:class`** | Dynamic class toggling. | `<div :class="classConfig">` |
| **`s-[event]`** | Event listener. | `<button s-click="save">` |

---

## Detailed Usage Examples

### 1. Displaying Data (`s-text` vs `s-html`)

* **`s-text`**: Updates the `textContent` of an element. This is safe and prevents XSS attacks.
* **`s-html`**: Updates the `innerHTML`. Only use this if you trust the content source.

```html
<div s-data="displayApp">
    <p>Message: <span s-text="msg"></span></p>
    
    <div s-html="rawHtml"></div>
</div>

<script>
spiki.data('displayApp', ()=>({
    msg: 'Hello World',
    rawHtml: '<b>Bold Text</b> and <i>Italic</i>'
}));
</script>

```

### 2. Dynamic Attributes (`:[attribute]`)

You can bind ANY HTML attribute to a variable by adding a colon `:` before the attribute name.

Common use cases: `:src`, `:href`, `:disabled`, `:placeholder`, `:id`.

```html
<div s-data="attrApp">
    <img :src="avatarUrl" alt="User Avatar">
    <a :href="profileLink">View Profile</a>
    
    <button :disabled="isProcessing">Submit</button>
</div>

<script>
spiki.data('attrApp', ()=>({
    avatarUrl: 'https://via.placeholder.com/150',
    profileLink: '/profile/user1',
    isProcessing: true
}));
</script>

```

### 3. Event Listeners (`s-[event]`)

Listen to any DOM event using the `s-` prefix. Examples: `s-click`, `s-submit`, `s-mouseenter`, `s-keyup`.

Spiki automatically passes the generic Event object to your function if you need it.

```html
<div s-data="eventApp">
    <button s-click="alertMe">Click Me</button>
    
    <div s-mouseenter="onHover" style="padding: 20px; border: 1px solid #ccc;">
        Hover Me
    </div>

    <form s-submit="saveData">
        <button>Save</button>
    </form>
</div>

<script>
spiki.data('eventApp', ()=>({
    alertMe() {
        alert('Button Clicked!');
    },
    onHover(e) {
        console.log('Mouse entered at:', e.clientX, e.clientY);
    },
    saveData(e) {
        e.preventDefault(); // Stop page reload
        console.log('Form Submitted');
    }
}));
</script>

```

### 4. Form Inputs (`s-model` vs `s-value`)

* **`s-model` (Two-Way):** When user types, data updates. When data updates, input updates. Use this for forms.
* **`s-value` (One-Way):** Only updates the input when data changes. Useful for calculated values or read-only inputs.

```html
<div s-data="formApp">
    <label>Username:</label>
    <input type="text" s-model="username">
    
    <label>Uppercase Preview:</label>
    <input type="text" s-value="previewName" readonly>
</div>

<script>
spiki.data('formApp', ()=>({
    username: 'john_doe',
    
    get previewName() {
        return this.username.toUpperCase();
    }
}));
</script>

```

### 5. Conditionals (`s-if`)

If the value is `false`, the element is completely removed from the DOM.

```html
<div s-data="toggleApp">
    <button s-click="toggle">Toggle</button>
    <p s-if="isOpen">I am visible!</p>
</div>

<script>
spiki.data('toggleApp', ()=>({
    isOpen: true,
    toggle() {
        this.isOpen = !this.isOpen;
    }
}));
</script>

```

### 6. Dynamic Classes (`:class`)

Bind CSS classes using a variable (getter) that returns an object.

```html
<div s-data="styleApp">
    <div :class="boxClass">I change color</div>
    <button s-click="toggle">Toggle Error</button>
</div>

<script>
spiki.data('styleApp', ()=>({
    isError: false,
    toggle() { this.isError = !this.isError; },
    
    // Getter returns: { 'class-name': boolean }
    get boxClass() {
        return {
            'bg-red': this.isError,
            'bg-blue': !this.isError
        };
    }
}));
</script>

```

---

## Mastering Lists (`s-for`)

The `s-for` directive is powerful but requires specific syntax to work correctly.

### 1. Basic Loop Requirement

You **MUST** use the `<template>` tag. Spiki uses the template to stamp out copies of your HTML.

```html
<ul>
    <template s-for="user in users" s-key="id">
        <li><span s-text="user.name"></span></li>
    </template>
</ul>

```

### 2. Accessing Data Inside Loop (`this.item`)

When you trigger an event inside a loop (like a click), Spiki automatically injects the current item into `this`. The property name matches your loop alias.

* If `s-for="item in items"`, you can access `this.item`.
* If `s-for="product in products"`, you can access `this.product`.

```html
<div s-data="shopApp">
    <ul>
        <template s-for="product in products" s-key="id">
            <li>
                <span s-text="product.name"></span>
                <button s-click="selectProduct">Select</button>
            </li>
        </template>
    </ul>
</div>

<script>
spiki.data('shopApp', ()=>({
    products: [
        { id: 1, name: 'Laptop' },
        { id: 2, name: 'Phone' }
    ],
    selectProduct() {
        // 'this.product' is automatically available
        console.log('You selected:', this.product.name);
    }
}));
</script>

```

### 3. Accessing Index

You can get the current index by using parentheses: `(item, index) in array`.

```html
<template s-for="(item, i) in list" s-key="id">
    <button s-click="remove">
        Remove Index <span s-text="i"></span>
    </button>
</template>

<script>
// Inside your JS:
remove() {
    // 'this.i' is automatically available
    this.list.splice(this.i, 1);
}
</script>

```

---

## Advanced Features

### 1. Side Effects (`s-effect`)

Use `s-effect` to run a function automatically whenever its dependencies change (like Auto-Save).

```html
<div s-data="saveApp" s-effect="autoSave">
    <textarea s-model="note"></textarea>
    <span s-text="status"></span>
</div>

<script>
spiki.data('saveApp', ()=>({
    note: localStorage.getItem('note') || '',
    status: '',
    
    autoSave() {
        // Spiki automatically tracks 'this.note' usage here
        localStorage.setItem('note', this.note);
        this.status = 'Saved!';
    }
}));
</script>

```

### 2. DOM References (`s-ref`)

Sometimes you need to access the raw DOM element (e.g., to focus an input or play a video).

```html
<div s-data="refApp">
    <input s-ref="myInput" type="text">
    <button s-click="focusMe">Focus Input</button>
</div>

<script>
spiki.data('refApp', ()=>({
    focusMe() {
        // Access DOM element via this.$refs
        this.$refs.myInput.focus();
    }
}));
</script>

```

### 3. Data Fetching / Ajax (`s-init`)

Use `s-init` to load data when the component mounts.

```html
<div s-data="usersApp" s-init="loadUsers">
    <p s-if="isLoading">Loading...</p>
    <ul>
        <template s-for="user in users" s-key="id">
            <li><span s-text="user.name"></span></li>
        </template>
    </ul>
</div>

<script>
spiki.data('usersApp', ()=>({
    isLoading: true,
    users: [],
    
    loadUsers() {
        var self = this;
        fetch('https://jsonplaceholder.typicode.com/users')
            .then(function(r) { return r.json() })
            .then(function(data) {
                self.users = data;
                self.isLoading = false;
            });
    }
}));
</script>

```

### 4. Advanced Form Elements

Spiki handles Checkboxes, Radios, and Selects automatically via `s-model`.

```html
<div s-data="forms">
    <label>
        <input type="checkbox" s-model="agreed"> I Agree
    </label>
    
    <select s-model="selectedFruit">
        <option value="apple">Apple</option>
        <option value="banana">Banana</option>
    </select>
    
    <input type="radio" name="g" value="male" s-model="gender"> Male
    <input type="radio" name="g" value="female" s-model="gender"> Female
</div>

```

---

## Core Concepts

### Component Instance (`this`)

Inside your functions, `this` refers to your component state. Spiki also injects special helper properties:

* **`this.$root`**: The HTML element containing the component.
* **`this.$refs`**: Access elements marked with `s-ref`.
* **`this.$store`**: Access the global store.
* **`this.$parent`**: Access the parent component (if nested).

### Lifecycle Hooks

Define these special methods to run code at specific times.

```javascript
spiki.data('clockApp', ()=>({
    time: new Date().toLocaleTimeString(),
    timerId: null,

    // Runs when component is mounted
    init() {
        var self = this;
        this.timerId = setInterval(function() {
            self.time = new Date().toLocaleTimeString();
        }, 1000);
    },

    // Runs when component is removed
    destroy() {
        clearInterval(this.timerId);
    }
}));

```

### Global Store

Share state across multiple components.

```javascript
// 1. Define Store
spiki.store('user', {
    name: 'John Doe',
    isLoggedIn: true
});

// 2. Use in Component
spiki.data('profile', ()=>({
    get userName() {
        return this.$store.user.name; // Reactive!
    }
}));

```

### `spiki.raw(proxy)`

Get the original object from a Spiki proxy. Useful for console logging or API calls.

```javascript
var cleanData = spiki.raw(this.myData);
console.log(cleanData); 

```

---

## Browser Support

Spiki requires a browser that supports **ES6 Proxy**.

* **Supported:** Chrome, Firefox, Edge, Safari (Modern versions).
* **Not Supported:** Internet Explorer 11.

## License

MIT License.
